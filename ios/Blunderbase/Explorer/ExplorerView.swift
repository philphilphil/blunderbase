import SwiftUI

/// Your own openings: a board, and under it what your games did from the position on it.
///
/// The phone's version of the web's explorer page, cut down to the table worth carrying —
/// the owner's games. The Lichess masters and rated pools the web page also reads stay in
/// the browser: a phone has room for one table under a board, and the one that can tell
/// you a habit is costing you games is your own.
///
/// The board is as wide as the phone and the rest scrolls under it, which is the opposite
/// of the game screen's trade. There the move list is the thing being read and the board
/// gives way to it; here the board is the control — every position is reached by tapping
/// on it or on a row — and the table is short by construction, one row per continuation
/// the owner has actually played.
///
/// Tapping a row plays its move, the board moves, and the table becomes that position's,
/// so a line is walked one position at a time and the owner's history is read at every
/// step. Tapping the board plays any move, book or not, and a position the owner has never
/// stood in says so in one line.
struct ExplorerView: View {
    @Environment(Session.self) private var session
    @State private var store = ExplorerStore()
    @State private var input = MoveInput()
    /// Whether the engine may speak: the average drop and the verdict on each game's move
    /// are its readings and go with it. See `Preferences.engineHidden`.
    @AppStorage(Preferences.Key.engineHidden) private var engineHidden = false

    init() {}

    /// The same screen over a store that already has a line and its answers — how a
    /// preview or a snapshot gets a board with something under it and no server to ask.
    init(store: ExplorerStore) {
        _store = State(initialValue: store)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                board
                lineBar
                transport
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        scopePicker
                        book
                        games
                    }
                }
            }
            .background(Theme.void)
            .navigationTitle("Explorer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
        }
        .task {
            guard let endpoints = session.endpoints else { return }
            store.attach(endpoints: endpoints, session: session)
        }
        // One request per position and lens: the key changes when either does, and the
        // store answers from memory for a square it has already asked about.
        .task(id: store.key) {
            await store.loadHere()
        }
        .onChange(of: store.fen) { _, _ in input.clear() }
    }

    // MARK: The board

    private var board: some View {
        BoardView(
            snapshot: store.snapshot,
            orientation: store.orientation,
            selectedSquare: input.selected,
            destinations: input.destinations,
            onSquareTap: { square in
                if let move = input.tapped(square, fen: store.fen) {
                    store.play(from: move.from, to: move.to)
                }
            }
        )
        .aspectRatio(1, contentMode: .fit)
        .overlay {
            if let pending = input.promotion {
                PromotionPicker(color: pending.color) { kind in
                    if let move = input.choose(kind) {
                        store.play(from: move.from, to: move.to, promotion: move.promotion)
                    }
                } onCancel: {
                    input.cancelPromotion()
                }
            }
        }
        .padding(6)
    }

    /// The line so far, in notation, or the fact that nothing has been played. It scrolls
    /// sideways rather than wrapping because a long line wrapping would push the board's
    /// controls down by a row every few moves.
    private var lineBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(store.lineText.isEmpty ? String(localized: "Starting position") : store.lineText)
                .font(Theme.Font.mono(12))
                .foregroundStyle(store.lineText.isEmpty ? Theme.faint : Theme.body)
                .padding(.horizontal, Theme.Metrics.gutter)
        }
        .frame(height: 26)
        .background(Theme.surface)
    }

    // MARK: Transport

    private var transport: some View {
        HStack(spacing: 0) {
            transportButton("backward.end.fill", enabled: store.canStepBack) { store.toStart() }
            transportButton("chevron.left", enabled: store.canStepBack) { store.step(-1) }

            Spacer(minLength: 0)

            Text(verbatim: "\(store.cursor)/\(store.line.count)")
                .font(Theme.Font.mono(12))
                .foregroundStyle(Theme.dim)
                .monospacedDigit()

            Spacer(minLength: 0)

            transportButton("chevron.right", enabled: store.canStepForward) { store.step(1) }
            transportButton("forward.end.fill", enabled: store.canStepForward) { store.toEnd() }
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .frame(height: 38)
        .background(Theme.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
    }

    private func transportButton(_ symbol: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(enabled ? Theme.body2 : Theme.faint2)
                .frame(width: Theme.Metrics.hit, height: 38)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: The lens

    /// Which of the owner's games the table counts. A segmented control because all three
    /// answers should be visible at once: "as Black" is a different repertoire from "as
    /// White", and the reader should not have to open anything to remember which they are
    /// looking at.
    private var scopePicker: some View {
        Picker("Games", selection: Binding(
            get: { store.scope },
            set: { store.scope = $0; Haptics.selectionChanged() }
        )) {
            ForEach(ExplorerStore.Scope.allCases) { scope in
                Text(scope.label).tag(scope)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.vertical, 8)
    }

    // MARK: The book

    @ViewBuilder
    private var book: some View {
        if let entry = store.bookHere, let moves = entry.moves, !moves.isEmpty {
            BookTable(entry: entry, fen: store.fen, engineHidden: engineHidden) { move, _ in
                if let uci = move.uci { store.play(uci: uci) }
            }
        } else if store.isLoadingHere {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(Theme.accent)
                Text("Looking this position up")
                    .font(Theme.Font.text(13))
                    .foregroundStyle(Theme.dim)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Metrics.gutter)
        } else if let failure = store.failure, !store.hasAnswerHere {
            VStack(alignment: .leading, spacing: 6) {
                Text(failure)
                    .font(Theme.Font.text(13))
                    .foregroundStyle(Theme.mistake)
                Button("Try again") {
                    Task { await store.loadHere() }
                }
                .font(Theme.Font.text(13, weight: .medium))
                .foregroundStyle(Theme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Theme.Metrics.gutter)
        } else if store.hasAnswerHere {
            Text(store.isAtStart
                 ? "No opening book yet: it needs two games through the same position."
                 : "You have not been here in another game.")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(Theme.Metrics.gutter)
        }
    }

    // MARK: Games in this line

    /// The games that reached the position, newest first, each a way into the game at that
    /// very move. Absent rather than empty when nothing did: the book's own sentence has
    /// already said so, and a second heading over nothing would say it twice.
    @ViewBuilder
    private var games: some View {
        if !store.gamesHere.isEmpty, let endpoints = session.endpoints {
            Text("Games in this line")
                .font(Theme.Font.text(11, weight: .semibold))
                .foregroundStyle(Theme.faint)
                .textCase(.uppercase)
                .padding(.horizontal, Theme.Metrics.gutter)
                .padding(.top, 14)
                .padding(.bottom, 4)

            ForEach(store.gamesHere) { occurrence in
                NavigationLink {
                    // The occurrence's ply is the cursor of the position the move was
                    // played *from* — the board the reader is looking at — so the game
                    // opens on the same square with the move still to come.
                    GameDetailView(
                        gameID: occurrence.game.id,
                        summary: occurrence.game,
                        endpoints: endpoints,
                        initialPly: occurrence.ply
                    )
                } label: {
                    gameRow(occurrence)
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Date · opponent · rating · the move they played from here · result — the web's
    /// columns for the same list, on one line.
    private func gameRow(_ occurrence: PositionOccurrence) -> some View {
        HStack(spacing: 8) {
            Text(Format.date(occurrence.game.playedAt))
                .font(Theme.Font.mono(11))
                .foregroundStyle(Theme.dim)
                .frame(width: 56, alignment: .leading)

            Text(occurrence.game.opponent ?? Format.absent)
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.body)
                .lineLimit(1)

            Text(occurrence.game.opponentRating.map(String.init) ?? Format.absent)
                .font(Theme.Font.mono(11))
                .foregroundStyle(Theme.faint)
                .fixedSize()

            Spacer(minLength: 4)

            HStack(spacing: 3) {
                Text(occurrence.moveSan ?? Format.absent)
                    .font(Theme.Font.mono(12, weight: .medium))
                    .foregroundStyle(Theme.body)
                if !engineHidden, occurrence.classification.isFlagged {
                    Text(occurrence.classification.glyph)
                        .font(Theme.Font.mono(11, weight: .bold))
                        .foregroundStyle(occurrence.classification.color)
                }
            }

            Text(Format.result(occurrence.game.result))
                .font(Theme.Font.mono(12, weight: .medium))
                .foregroundStyle(Format.outcomeColor(occurrence.game.outcome))
                .frame(width: 34, alignment: .trailing)
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .frame(height: 36)
        .frame(maxWidth: .infinity)
        .background(Theme.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.hairline).frame(height: 0.5)
        }
        .contentShape(Rectangle())
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                store.flip()
                Haptics.selectionChanged()
            } label: {
                Image(systemName: "arrow.up.arrow.down")
                    .foregroundStyle(Theme.dim)
            }
            .accessibilityLabel("Flip the board")

            Button {
                store.reset()
                input.clear()
            } label: {
                Image(systemName: "arrow.counterclockwise")
                    .foregroundStyle(store.isAtStart && store.line.isEmpty ? Theme.faint2 : Theme.dim)
            }
            .disabled(store.isAtStart && store.line.isEmpty)
            .accessibilityLabel("Back to the starting position")
        }
    }
}
