import SwiftUI
import UIKit

/// The library.
///
/// This is the screen the app opens on, and the only one that has to stay fast with ten
/// thousand rows behind it, so two structural choices are worth stating.
///
/// **It is a `List`, not a `ScrollView` of a `LazyVStack`.** A lazy stack builds rows lazily
/// but never releases them, so scrolling a long library grows without bound; `List` recycles
/// cells. `NavigationLink`, `refreshable` and the search field's scroll-to-dismiss behaviour
/// are also native to it, and each of them is a thing that would otherwise be re-implemented
/// slightly wrong. The price is fighting the default chrome — hence the row insets,
/// separators and backgrounds all being turned off in one place below.
///
/// **Paging is driven by the last row appearing**, not by a scroll offset. An offset needs a
/// threshold, and a threshold in points is wrong at every text size; a row that has come on
/// screen is the same fact expressed in the list's own terms. Every reason not to fetch —
/// one already in flight, the end reached, a failed state — is a guard inside
/// `GamesStore.loadMore()`, so this call site stays a single line.
struct GamesListView: View {
    @Environment(Session.self) private var session
    @State private var store = GamesStore()
    /// The six worst moments of the last month, which ride above the list. Their own store,
    /// because they are one unfiltered call that fails on its own — see `MomentsStore`.
    @State private var moments = MomentsStore()

    var body: some View {
        NavigationStack {
            content
                .background(Theme.void)
                .navigationTitle("Games")
                .navigationBarTitleDisplayMode(.inline)
                .searchable(
                    text: searchBinding,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Opponent, ECO, PGN text"
                )
                .safeAreaInset(edge: .top, spacing: 0) {
                    GameFilterBar(store: store)
                }
        }
        .task {
            guard let endpoints = session.endpoints else { return }
            store.attach(endpoints: endpoints, session: session)
            moments.attach(endpoints: endpoints, session: session)
            // The list first and the strip after it, deliberately: the strip is drawn inside
            // the loaded list, so a phone on a slow connection sees the library arrive rather
            // than waiting on six tiles it cannot see yet.
            if store.state == .idle { await store.load() }
            if moments.state == .idle { await moments.load() }
        }
    }

    /// `searchable` wants a `Binding`, and the store owns the debounce, so this is a plain
    /// pass-through rather than a second copy of the text living in the view.
    private var searchBinding: Binding<String> {
        Binding(get: { store.search }, set: { store.search = $0 })
    }

    // MARK: The four states

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle, .loading:
            skeleton
        case .failed(let message):
            failure(message)
        case .loaded:
            if store.cards.isEmpty {
                empty
            } else {
                rows
            }
        }
    }

    private var rows: some View {
        List {
            strip
            Section {
                ForEach(store.cards) { card in
                    row(card)
                }
                if !store.reachedEnd {
                    footer
                }
            } header: {
                header
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 0)
        .refreshable {
            // Two independent requests, so they go together: the pull ends when both have
            // answered rather than when the slower one has waited for the other.
            async let library: Void = store.refresh()
            async let recent: Void = moments.refresh()
            _ = await (library, recent)
        }
    }

    /// The worst-moments strip, as the list's own first rows.
    ///
    /// A section of the `List` rather than a header on the games section: a plain list pins
    /// its section headers, and a strip that stuck to the top of the screen would be exactly
    /// the fixed height it must not have.
    @ViewBuilder
    private var strip: some View {
        if let endpoints = session.endpoints, moments.isVisible(over: store) {
            Section {
                WorstMomentsStrip(store: moments, endpoints: endpoints)
                    .modifier(BareRow())
            }
        }
    }

    @ViewBuilder
    private func row(_ card: GameCard) -> some View {
        if let endpoints = session.endpoints {
            NavigationLink {
                GameDetailView(gameID: card.id, summary: card.game, endpoints: endpoints)
            } label: {
                GameRowView(card: card)
            }
            .buttonStyle(.plain)
            .modifier(BareRow())
            .contextMenu {
                if let link = link(to: card.id) {
                    Button {
                        UIPasteboard.general.string = link
                    } label: {
                        Label("Copy link", systemImage: "link")
                    }
                }
            }
            .onAppear {
                guard card.id == store.cards.last?.id else { return }
                Task { await store.loadMore() }
            }
        }
    }

    /// How many games there are, and whether what is on screen is all of them.
    ///
    /// One line, and it changes shape rather than growing: unfiltered it is a count of the
    /// library, filtered it is how much of the library survived. The distinction matters
    /// because "1,284 games" under a set filter would be a lie about what is below it.
    private var header: some View {
        Text(headerText)
            .font(Theme.Font.mono(11))
            .foregroundStyle(Theme.dim)
            .textCase(nil)
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.void)
            .modifier(BareRow())
    }

    private var headerText: String {
        let total = Format.count(store.total)
        guard store.hasFilters else {
            return store.total == 1 ? "1 game" : "\(total) games"
        }
        if store.reachedEnd {
            return store.total == 1 ? "1 game matches these filters" : "\(total) match these filters"
        }
        return "\(Format.count(store.cards.count)) of \(total) match these filters"
    }

    /// The spinner that says another page is coming. It sits in the list rather than over it
    /// so it scrolls with the content and does not sit on top of the last row.
    private var footer: some View {
        HStack {
            Spacer()
            ProgressView().tint(Theme.dim)
            Spacer()
        }
        .padding(.vertical, 14)
        .background(Theme.void)
        .modifier(BareRow())
        .accessibilityLabel("Loading more games")
    }

    /// Skeleton rows rather than a spinner in the middle of the screen.
    ///
    /// The list has a shape — two lines and a stamp — and drawing that shape while the first
    /// page is in flight means the content arrives *into* the layout instead of replacing a
    /// different one, which is the difference between a screen that settles and one that
    /// jumps.
    private var skeleton: some View {
        VStack(spacing: 0) {
            ForEach(0..<8, id: \.self) { index in
                SkeletonRow()
                    .opacity(1 - Double(index) * 0.1)
            }
            Spacer()
        }
        .background(Theme.void)
        .accessibilityElement()
        .accessibilityLabel("Loading games")
    }

    private func failure(_ message: String) -> some View {
        Placeholder(
            symbol: "exclamationmark.triangle",
            tint: Theme.mistake,
            title: message,
            detail: nil,
            actionTitle: "Try again"
        ) {
            Task { await store.load() }
        }
    }

    /// Two different nothings. "No games match these filters" is a filter problem and offers
    /// the way out of it; an empty library is a fact about the server and offers nothing,
    /// because importing is done in the browser and a button here could not do it.
    @ViewBuilder
    private var empty: some View {
        if store.hasFilters {
            Placeholder(
                symbol: "line.3.horizontal.decrease.circle",
                tint: Theme.dim,
                title: "No games match these filters",
                detail: nil,
                actionTitle: "Clear filters"
            ) {
                Task { await store.clearFilters() }
            }
        } else {
            Placeholder(
                symbol: "tray",
                tint: Theme.dim,
                title: "No games yet",
                detail: "Games appear here once they are imported in the web app.",
                actionTitle: nil,
                action: nil
            )
        }
    }

    /// The address of a game in the browser — the same path the web app uses, so a link
    /// pasted into a note or a chat opens the game somebody was looking at.
    private func link(to id: Int) -> String? {
        guard let serverURL = session.serverURL else { return nil }
        return serverURL.appendingPathComponent("games").appendingPathComponent(String(id)).absoluteString
    }
}

/// A list row stripped of every default `List` gives it: the inset, the separator and the
/// selection tint. Applied in one modifier because forgetting one of the three is what makes
/// a custom row look almost right.
private struct BareRow: ViewModifier {
    func body(content: Content) -> some View {
        content
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

/// One row's worth of grey, in the real row's proportions.
private struct SkeletonRow: View {
    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                block(width: 190, height: 11)
                block(width: 130, height: 9)
            }
            Spacer()
            RoundedRectangle(cornerRadius: Theme.Radius.chip)
                .fill(Theme.graphBg)
                .frame(width: 46, height: 22)
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.vertical, 9)
        .frame(height: 64)
        .background(Theme.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
    }

    private func block(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: Theme.Radius.chip)
            .fill(Theme.elevated)
            .frame(width: width, height: height)
    }
}

/// The empty and failed states, which are the same shape: a symbol, a sentence, and at most
/// one thing to do about it. Sharing them keeps the two from drifting into two different
/// paddings, and makes "there is nothing to do here" an explicit `nil` rather than an
/// omission.
struct Placeholder: View {
    let symbol: String
    let tint: Color
    let title: String
    var detail: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 26))
                .foregroundStyle(tint)
            Text(title)
                .font(Theme.Font.text(14))
                .foregroundStyle(Theme.body)
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .font(Theme.Font.text(12))
                    .foregroundStyle(Theme.faint)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(Theme.Font.text(13, weight: .medium))
                    .foregroundStyle(Theme.accent)
                    .frame(minHeight: Theme.Metrics.hit)
            }
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.void)
    }
}
