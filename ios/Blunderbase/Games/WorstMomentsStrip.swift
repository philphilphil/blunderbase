import SwiftUI
import Observation

/// Six things to work on, above the library.
///
/// This is the phone's version of the web dashboard's "worst recent moments" panel
/// (`web/src/routes/dashboard/WorstMomentsRow.tsx`): the six worst moves of the last thirty
/// days, one per game, ranked by the win percentage they gave away. The phone has no
/// dashboard to put it on, so it goes at the top of the games list — the screen the app
/// opens on, and the only one that is already about the library as a whole.
///
/// **Tiles, not boards.** The web draws each moment as a small position with the blunder in
/// red and the engine's move as an arrow. A board that size is legible on a laptop and is
/// not on a phone — at three tiles across it would be forty points square — so the phone
/// spends the same room on words instead: the glyph, the move, what it cost, who it was
/// against and when. The position is one tap away, which is where it was always answered.
/// That is also why the `??` badge comes back here when the web dropped it: the web's tile
/// says "blunder" by drawing the move in the blunder's red on a board, and a tile with no
/// board has to say it.
///
/// **It scrolls away with the list.** The strip is the first section of the `List` rather
/// than a `safeAreaInset` beside the filter bar, because it is content and not chrome:
/// something read once on arrival must not cost eighty points of every screen after that.
///
/// **It is not shown over a filtered list.** A search or a filter makes the list an answer
/// to a question, and six moments from the whole library sitting on top of that answer are
/// answering a different one. See `MomentsStore.isVisible(over:)`.
struct WorstMomentsStrip: View {
    let store: MomentsStore
    /// Where a tile leads. Held rather than reached for through the environment so the strip
    /// can be drawn in a preview without a session.
    let endpoints: Endpoints

    /// Wide enough for `24… Nxe4` and a name beside it, narrow enough that the second tile
    /// is half on screen — which is what says the row scrolls without an affordance for it.
    private static let tileWidth: CGFloat = 152

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            heading
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    switch store.state {
                    case .idle, .loading:
                        ForEach(0..<MomentsStore.count, id: \.self) { _ in skeleton }
                    case .loaded, .failed:
                        ForEach(store.moments) { moment in tile(moment) }
                    }
                }
                .padding(.horizontal, Theme.Metrics.gutter)
            }
        }
        .padding(.vertical, 8)
        .background(Theme.void)
    }

    /// What the row is, and what "recent" means, in one line — the web says both in its
    /// section head and the window is the part nobody would guess.
    private var heading: some View {
        Text("Worst moments · last \(MomentsStore.recentDays) days")
            .font(Theme.Font.mono(11))
            .foregroundStyle(Theme.dim)
            .padding(.horizontal, Theme.Metrics.gutter)
    }

    // MARK: A tile

    private func tile(_ moment: MomentResponse) -> some View {
        NavigationLink {
            // The moment's ply is the cursor of the position it was played *from*, so the
            // game opens on the question — the flagged move still to come and the engine's
            // answer on screen — rather than after it.
            GameDetailView(
                gameID: moment.game.id,
                summary: moment.game,
                endpoints: endpoints,
                initialPly: moment.ply
            )
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Text(moment.classification.glyph)
                        .font(Theme.Font.mono(11, weight: .bold))
                        .foregroundStyle(moment.classification.color)
                    Text(Format.move(ply: moment.ply, san: moment.san))
                        .font(Theme.Font.mono(12, weight: .medium))
                        .foregroundStyle(Theme.body)
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text(Format.winLoss(moment.winLoss))
                        .font(Theme.Font.mono(12))
                        .foregroundStyle(Format.severityColor(moment.winLoss))
                        .fixedSize()
                }
                Text(subtitle(moment))
                    .font(Theme.Font.text(11))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 8)
            .frame(width: WorstMomentsStrip.tileWidth, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
            .overlay {
                RoundedRectangle(cornerRadius: Theme.Radius.card)
                    .strokeBorder(Theme.line, lineWidth: 0.5)
            }
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.card))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(label(moment))
    }

    /// Who it was against and when — the two facts that turn a move into a memory.
    private func subtitle(_ moment: MomentResponse) -> String {
        let opponent = moment.game.opponent ?? Format.absent
        return "\(opponent) · \(Format.date(moment.game.playedAt))"
    }

    private func label(_ moment: MomentResponse) -> String {
        let move = Format.move(ply: moment.ply, san: moment.san)
        return "\(moment.classification.name), \(move) against \(subtitle(moment)),"
            + " gave away \(Format.winPercent(moment.winLoss))"
    }

    /// A tile's worth of grey, in the tile's own proportions, so the strip does not change
    /// height when the moments arrive.
    private var skeleton: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: Theme.Radius.chip)
                .fill(Theme.elevated)
                .frame(width: 84, height: 11)
            RoundedRectangle(cornerRadius: Theme.Radius.chip)
                .fill(Theme.graphBg)
                .frame(width: 108, height: 9)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 8)
        .frame(width: WorstMomentsStrip.tileWidth, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
        .accessibilityHidden(true)
    }
}

/// The strip's own small store.
///
/// It is separate from `GamesStore` rather than another field on it because the two answer
/// different questions and fail independently: the list is paged, filtered and reloaded on
/// every keystroke, and this is one unfiltered call whose whole answer is six rows. Folding
/// it in would put a second generation stamp and a second failure mode into the file that
/// exists to keep the list's ordering honest.
///
/// **A failure hides the strip rather than reporting it.** The list underneath is making the
/// same request against the same server, so a strip drawing its own error box would say the
/// same thing twice, in the smaller of the two places.
///
/// The web invalidates this query when an analysis finishes, since a new run can produce a
/// new worst moment. The phone cannot yet: `EventsClient` decodes only the three `stream.*`
/// frames, and `analysis.done` is not among them. Until it is, the strip is as fresh as the
/// last pull-to-refresh, which is also when the list under it was last right.
@Observable
@MainActor
final class MomentsStore {

    /// Three states, not four: a failure is a nothing here, and the view draws it as one.
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed
    }

    /// Six, as on the web: enough that a single bad game cannot fill the row, which is why
    /// the service keeps one moment per game.
    static let count = 6
    /// What "recent" means. Long enough to hold a quiet fortnight, short enough to be
    /// current — the web's own window, said out loud in the heading.
    static let recentDays = 30

    private(set) var moments: [MomentResponse] = []
    private(set) var state: LoadState = .idle

    @ObservationIgnored private var endpoints: Endpoints?
    /// Weak, and only to hand it a 401: a refused cookie is the whole app's problem, not
    /// this strip's.
    @ObservationIgnored private weak var session: Session?

    func attach(endpoints: Endpoints, session: Session?) {
        self.session = session
        guard self.endpoints == nil else { return }
        self.endpoints = endpoints
    }

    /// Whether the strip belongs on screen at all, above this list.
    ///
    /// Two reasons to be absent, and they are deliberately one question: the library is
    /// narrowed, so the strip would answer something nobody asked; or there is nothing to
    /// show — no moments in the window, or a request that failed — and an empty box saying
    /// so is worse than the space it takes. Only "still loading" draws without content, and
    /// then it draws the shape the content will have.
    func isVisible(over games: GamesStore) -> Bool {
        guard !games.hasFilters else { return false }
        switch state {
        case .idle, .loading: return true
        case .loaded: return !moments.isEmpty
        case .failed: return false
        }
    }

    /// Take moments that have already been fetched.
    ///
    /// Separate from `load` for the reason `GameStore.adopt` is: what the strip *does* with
    /// six moments — whether it is on screen at all, and what a tile reads — is the half
    /// worth exercising, and the fetch is not. A preview and a test both want this half
    /// without a server to fake.
    func adopt(_ moments: [MomentResponse]) {
        self.moments = moments
        self.state = .loaded
    }

    /// The first fetch, with the skeleton.
    func load() async {
        await fetch(showingSkeleton: true)
    }

    /// Pull-to-refresh: the tiles on screen stay until the new ones land, because the list's
    /// own spinner already says something is happening.
    func refresh() async {
        await fetch(showingSkeleton: false)
    }

    private func fetch(showingSkeleton: Bool) async {
        guard let endpoints else { return }
        if showingSkeleton { state = .loading }
        do {
            moments = try await endpoints.worstMoments(
                days: MomentsStore.recentDays,
                amount: MomentsStore.count
            )
            state = .loaded
        } catch {
            session?.handle(error)
            moments = []
            state = .failed
        }
    }
}
