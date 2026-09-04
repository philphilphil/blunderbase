import Foundation
import Observation

/// The library, as one screen holds it: a filter, a page of rows, and how much more there is.
///
/// Everything that makes the list *move* lives here rather than in the view, for one
/// reason: a games list is a single question asked repeatedly, and the bugs it invites are
/// all about two answers to different questions arriving out of order. Typing "hik" then
/// deleting a letter, pulling to refresh mid-page, tapping a filter while page three is in
/// flight — each starts a request whose answer must not land on top of a newer one. So
/// every load stamps a `generation`, and a reply whose stamp is stale is dropped on the
/// floor instead of being merged.
///
/// Two more rules are worth stating because they are not visible in the types:
///
/// - **Search is debounced here, not in the view.** A view that reloads in `onChange` fires
///   a request per keystroke; the debounce belongs next to the request it is throttling, so
///   there is exactly one place to look when the list feels chatty.
/// - **Paging counts what the server sent, not what we kept.** `fetched` is the offset for
///   the next page. It is deliberately not `cards.count`: a game imported while somebody is
///   paging shifts every row down one, the next page repeats a row, the dedupe drops it —
///   and if the offset were the kept count the list would ask for the same page for ever.
@Observable
@MainActor
final class GamesStore {

    /// The four states the list actually renders. `failed` carries the sentence to show,
    /// already resolved from the error, because a view should not be unwrapping `APIError`.
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    /// A page. Fifty is what the web asks for and what the backend's default is; a phone
    /// row is taller, so this is roughly five screens of scrolling per request.
    static let pageSize = 50

    /// Long enough that a typed word is one request, short enough that the list does not
    /// feel like it is thinking. The web's own search input uses the same interval.
    static let searchDebounce: Duration = .milliseconds(300)

    private(set) var cards: [GameCard] = []
    /// The size of the whole filtered set, which is what lets the header say "50 of 1,284".
    private(set) var total = 0
    private(set) var state: LoadState = .idle
    private(set) var isLoadingMore = false
    /// True once the server has answered with everything it has, so the footer stops
    /// offering a spinner that will never resolve.
    private(set) var reachedEnd = false
    /// The filter, exposed read-only: it is changed through `apply(_:)` so that no caller
    /// can leave it changed without reloading against it.
    private(set) var query = GameQuery()

    /// What is in the search field. Assigning it schedules a reload; it is not applied to
    /// `query` until the debounce fires, so `query.text` is always what the rows on screen
    /// were actually fetched with.
    var search: String = "" {
        didSet {
            guard search != oldValue, !isRewritingSearch else { return }
            scheduleSearch()
        }
    }

    @ObservationIgnored private var endpoints: Endpoints?
    /// Held weakly and only to hand it a failure: a 401 anywhere means the cookie is gone
    /// and the whole app has to go back to the connect screen, and that decision is the
    /// session's rather than this list's.
    @ObservationIgnored private weak var session: Session?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var isRewritingSearch = false
    /// Bumped by every reset. A reply carrying an older stamp is ignored.
    @ObservationIgnored private var generation = 0
    /// How many rows the server has handed over for this filter — the next page's offset.
    @ObservationIgnored private var fetched = 0

    init() {
        query.limit = GamesStore.pageSize
    }

    /// Give the store its connection.
    ///
    /// It is separate from `init` because the view is constructed before the environment is
    /// readable, and a store that took `Endpoints` at init would have to be rebuilt on every
    /// body evaluation — which would throw the loaded page away each time. Calling it twice
    /// with the same server is a no-op, so a `task` that runs again after a background does
    /// not reload the list out from under the reader.
    func attach(endpoints: Endpoints, session: Session?) {
        self.session = session
        guard self.endpoints == nil else { return }
        self.endpoints = endpoints
    }

    /// Whether anything narrows the library right now — the question the empty state asks to
    /// decide between "no games match these filters" and "there are no games yet". Paging,
    /// order and `whose` are deliberately not filters: they are always set.
    var hasFilters: Bool {
        query.text != nil
            || query.outcome != nil
            || query.result != nil
            || query.color != nil
            || query.source != nil
            || !query.speeds.isEmpty
            || query.eco != nil
            || query.opponent != nil
            || query.timeControl != nil
            || query.hasBlunders != nil
            || query.analyzed != nil
            || query.deepAnalyzed != nil
            || query.since != nil
            || query.until != nil
            || !search.isEmpty
    }

    /// Whether the footer should ask for another page. False while one is in flight, so the
    /// last row appearing twice cannot start two requests.
    var canLoadMore: Bool {
        state == .loaded && !reachedEnd && !isLoadingMore
    }

    // MARK: Loading

    /// The first page, from scratch. Shows the skeleton, because there is nothing on screen
    /// to keep.
    func load() async {
        await reload(showingSpinner: true)
    }

    /// The same reset, without the skeleton: pull-to-refresh draws its own spinner, and
    /// blanking rows the reader is looking at to replace them with the same rows is worse
    /// than a moment of stale content.
    func refresh() async {
        await reload(showingSpinner: false)
    }

    /// Change the filter and start again from the top.
    ///
    /// It takes a mutation rather than a whole `GameQuery` so a caller changes the one field
    /// it means to and cannot silently reset the sort or the page size at the same time.
    func apply(_ mutate: (inout GameQuery) -> Void) async {
        mutate(&query)
        await load()
    }

    /// Back to the whole library. Sort, page size and `whose` survive: they are how the
    /// reader has chosen to *look* at the library, not what they have narrowed it to.
    func clearFilters() async {
        searchTask?.cancel()
        isRewritingSearch = true
        search = ""
        isRewritingSearch = false

        var fresh = GameQuery()
        fresh.limit = query.limit
        fresh.order = query.order
        fresh.direction = query.direction
        fresh.whose = query.whose
        query = fresh
        await load()
    }

    /// The next page. Safe to call from `onAppear` on the last row — every reason not to
    /// fetch is a guard here rather than a condition at the call site.
    func loadMore() async {
        guard let endpoints, canLoadMore else { return }
        isLoadingMore = true
        let stamp = generation
        var next = query
        next.offset = fetched
        do {
            let page = try await endpoints.listGames(next)
            guard stamp == generation else { return }
            query.offset = next.offset
            fetched += page.games.count
            total = page.total
            append(page.games)
            reachedEnd = page.games.isEmpty || fetched >= total
        } catch {
            guard stamp == generation else { return }
            session?.handle(error)
            // The rows already on screen stay. A page that failed to arrive is a footer's
            // problem; replacing a working list with an error screen would lose the
            // reader's place over a dropped request.
            reachedEnd = true
        }
        if stamp == generation { isLoadingMore = false }
    }

    // MARK: Internals

    private func reload(showingSpinner: Bool) async {
        guard let endpoints else { return }
        generation += 1
        let stamp = generation
        isLoadingMore = false
        query.offset = 0
        if showingSpinner { state = .loading }
        do {
            let page = try await endpoints.listGames(query)
            guard stamp == generation else { return }
            cards = page.games
            total = page.total
            fetched = page.games.count
            reachedEnd = page.games.isEmpty || fetched >= page.total
            state = .loaded
        } catch {
            guard stamp == generation else { return }
            session?.handle(error)
            cards = []
            total = 0
            fetched = 0
            reachedEnd = true
            state = .failed(GamesStore.message(for: error))
        }
    }

    /// Append a page, keeping the rows already held.
    ///
    /// The dedupe is not paranoia: the library grows while it is being read, and an import
    /// landing between two pages shifts the offsets so that the same game arrives twice.
    /// Two rows with the same `id` in a `ForEach` is a rendering bug, not a cosmetic one.
    private func append(_ page: [GameCard]) {
        var seen = Set(cards.map(\.id))
        for card in page where seen.insert(card.id).inserted {
            cards.append(card)
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: GamesStore.searchDebounce)
            guard !Task.isCancelled, let self else { return }
            let trimmed = self.search.trimmingCharacters(in: .whitespacesAndNewlines)
            let text: String? = trimmed.isEmpty ? nil : trimmed
            guard text != self.query.text else { return }
            self.query.text = text
            await self.load()
        }
    }

    /// The sentence to show. `APIError` writes its own, and anything else falls back to the
    /// system's — either way the view gets a string rather than an error to interpret.
    private static func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
