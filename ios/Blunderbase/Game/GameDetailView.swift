import SwiftUI

/// The game screen.
///
/// The web version is one workspace with the board flush left and every panel beside it.
/// The phone stacks the same idea: the board and its immediate context on top, the panels
/// underneath, both on screen at once. Nothing is hidden behind a gesture.
///
/// **The board and the panes share one column of space and trade it.** The panes have a
/// height the reader sets by dragging the handle between them, and the board takes whatever
/// is left, sized to fit. Reading the move list makes the board smaller rather than covering
/// it, which is the difference between a panel and a sheet, and the reason the sheet went
/// away: a sheet that is always up is a panel with a dimming layer and a gesture that can
/// dismiss it by accident.
///
/// Two ways to move through the game, for different hands: drag across the board to walk it
/// move by move, tap a move or the eval graph to land exactly.
struct GameDetailView: View {
    @Environment(Session.self) private var session
    @Environment(EventsClient.self) private var events
    @State private var store: GameStore
    /// The live analysis board, which lives as long as this screen and no longer.
    @State private var live: LiveEngineStore
    @State private var pane: GamePanes.Pane = .moves
    @State private var dragAnchor: Int?
    /// The panes' height, in points, or nil until the first layout picks a default.
    ///
    /// It is a stored height rather than a named detent because the drag is continuous —
    /// the reader lands where they let go, and the two named stops are only where a
    /// double-tap and the chevron go.
    @State private var paneHeight: CGFloat?
    @State private var paneHeightAtDragStart: CGFloat?
    /// Which piece is selected and where it may go. Board-only state, so it lives here and
    /// not in the store, which is about the game.
    @State private var input = MoveInput()

    private let summary: GameSummary?
    private let onPreviousGame: (() -> Void)?
    private let onNextGame: (() -> Void)?

    init(
        gameID: Int,
        summary: GameSummary? = nil,
        endpoints: Endpoints,
        onPreviousGame: (() -> Void)? = nil,
        onNextGame: (() -> Void)? = nil
    ) {
        _store = State(initialValue: GameStore(gameID: gameID, endpoints: endpoints))
        // The game id is echoed back on the stream, so `GET /streams` can say which game a
        // board belongs to. The server never reads it; a person looking at the list does.
        _live = State(initialValue: LiveEngineStore(surface: .game, gameID: gameID))
        self.summary = summary
        self.onPreviousGame = onPreviousGame
        self.onNextGame = onNextGame
    }

    /// The same screen over a store that already has its game.
    ///
    /// The layout is the part of this screen that gets argued about, and judging a layout
    /// needs a real game on it — a full move list, a flagged move, arrows, a clock. This
    /// initialiser is how a preview or a snapshot gets one without a server to fetch from,
    /// which is the difference between looking at the screen and looking at a spinner.
    init(
        store: GameStore,
        summary: GameSummary? = nil,
        onPreviousGame: (() -> Void)? = nil,
        onNextGame: (() -> Void)? = nil
    ) {
        _store = State(initialValue: store)
        _live = State(initialValue: LiveEngineStore(surface: .game, gameID: store.gameID))
        self.summary = summary
        self.onPreviousGame = onPreviousGame
        self.onNextGame = onNextGame
    }

    var body: some View {
        content
            .background(Theme.void)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            // The tab bar goes away in here. The board and the panes are already trading one
            // column of height, and Games / Notes / Settings are not something anyone
            // switches to mid-game; the back button is the way out, and the bar comes back
            // with the list it belongs to.
            .toolbar(.hidden, for: .tabBar)
            .task {
                Haptics.prepare()
                if let url = session.serverURL {
                    live.attach(serverURL: url, events: events)
                }
                guard store.state != .loaded else { return }
                await store.load(maiaTargetElo: session.maiaTargetElo)
            }
            .onChange(of: store.snapshot.fen, initial: true) { _, fen in
                input.clear()
                // The live board follows the cursor. The store debounces and only sends a
                // patch when it is switched on, so this is cheap on every step.
                live.setPosition(fen, ply: store.cursor)
            }
            .onDisappear {
                store.stopPlay()
                // Close the analysis board rather than leaving it for the server's reaper:
                // there are only two slots, and the next screen wants one.
                live.detach()
            }
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle, .loading:
            loading
        case .failed(let message):
            failure(message)
        case .loaded:
            board
        }
    }

    private var loading: some View {
        VStack(spacing: 12) {
            ProgressView().tint(Theme.accent)
            Text("Loading the game")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func failure(_ message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundStyle(Theme.mistake)
            Text(message)
                .font(Theme.Font.text(14))
                .foregroundStyle(Theme.body2)
                .multilineTextAlignment(.center)
            Button("Try again") {
                Task { await store.load(maiaTargetElo: session.maiaTargetElo) }
            }
            .font(Theme.Font.text(14, weight: .medium))
            .foregroundStyle(Theme.accent)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: The board and the panes, sharing one column

    private var board: some View {
        GeometryReader { outer in
            let panes = paneHeight(in: outer.size)
            VStack(spacing: 0) {
                players

                GeometryReader { geometry in
                    let side = min(
                        geometry.size.width - Theme.Metrics.evalBarWidth - 3 * boardMargin,
                        geometry.size.height - 2 * boardMargin
                    )
                    HStack(spacing: boardMargin) {
                        EvalBarView(
                            whiteWin: store.whiteWin,
                            scoreLabel: store.scoreLabel,
                            orientation: store.orientation
                        )
                        .frame(width: Theme.Metrics.evalBarWidth, height: side)

                        BoardView(
                            snapshot: store.snapshot,
                            orientation: store.orientation,
                            arrows: store.arrows,
                            glyph: store.glyph,
                            selectedSquare: input.selected,
                            destinations: input.destinations,
                            onSquareTap: { square in
                                if let move = input.tapped(square, fen: store.snapshot.fen) {
                                    store.play(from: move.from, to: move.to)
                                }
                            }
                        )
                        .frame(width: side, height: side)
                        .gesture(walkGesture(stepWidth: side / 14))
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
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(boardMargin)
                }
                // The board takes what the panes leave. Shrinking rather than scrolling is
                // what keeps the position and the move list legible at the same time.
                .frame(maxHeight: .infinity)

                transport

                PaneHandle(
                    isExpanded: panes >= expandedPaneHeight(in: outer.size.height) - 1,
                    onDrag: { translation in
                        let start = paneHeightAtDragStart ?? panes
                        if paneHeightAtDragStart == nil { paneHeightAtDragStart = start }
                        // Dragging up is a negative translation and a taller pane.
                        paneHeight = clampPaneHeight(start - translation, in: outer.size.height)
                    },
                    onDragEnded: {
                        paneHeightAtDragStart = nil
                        Haptics.selectionChanged()
                    },
                    onToggle: { togglePanes(in: outer.size) }
                )

                GamePanes(store: store, live: live, pane: $pane, isReadOnly: session.isReadOnly)
                    .frame(height: panes)
            }
        }
    }

    // MARK: How tall the panes are

    /// The chrome around the board that is not the panes: the players strip above it, the
    /// transport and the handle below. Kept as one number because the pane height is
    /// derived by subtraction, and a row whose height changes has to change here too.
    private static let chromeHeight: CGFloat = 34 + 38 + 26

    /// How wide a board can be, which is what a board wants to be.
    private func fullWidthBoardSide(_ width: CGFloat) -> CGFloat {
        width - Theme.Metrics.evalBarWidth - 3 * boardMargin
    }

    /// The panes' resting height: **whatever is left once the board is as wide as the phone**.
    ///
    /// The first version of this took a fixed third of the screen, which read fine on a tall
    /// phone and badly on a short one — the board came out smaller than its own column and
    /// sat in a band of empty space. Deriving the split the other way round fixes that, and
    /// says the right thing about the screen: the board is the thing, and the panes have the
    /// rest. On a short phone the rest is not much, which is honest, and the reader can drag
    /// for more the moment they want it.
    private func defaultPaneHeight(in size: CGSize) -> CGFloat {
        clampPaneHeight(size.height - Self.chromeHeight - fullWidthBoardSide(size.width), in: size.height)
    }

    /// As tall as the panes go. The board keeps a floor rather than disappearing, because a
    /// game screen with no board on it is a move list, and the reader can always go back.
    private func expandedPaneHeight(in total: CGFloat) -> CGFloat {
        clampPaneHeight(total * 0.68, in: total)
    }

    private func clampPaneHeight(_ height: CGFloat, in total: CGFloat) -> CGFloat {
        let smallest = GamePanes.minimumHeight
        let largest = max(smallest, total - Self.minimumBoardBlock)
        return min(max(height, smallest), largest)
    }

    private func paneHeight(in size: CGSize) -> CGFloat {
        clampPaneHeight(paneHeight ?? defaultPaneHeight(in: size), in: size.height)
    }

    private func togglePanes(in size: CGSize) {
        let expanded = expandedPaneHeight(in: size.height)
        let current = paneHeight(in: size)
        withAnimation(.easeOut(duration: 0.22)) {
            paneHeight = current >= expanded - 1 ? defaultPaneHeight(in: size) : expanded
        }
        Haptics.selectionChanged()
    }

    /// Everything above the panes that is not the board, plus a board small enough to still
    /// read. This is the floor the panes may not grow past.
    private static let minimumBoardBlock: CGFloat = chromeHeight + 150

    /// Switch to a pane and make sure there is room to see it.
    private func show(_ pane: GamePanes.Pane) {
        self.pane = pane
        Haptics.selectionChanged()
    }

    private var boardMargin: CGFloat { 6 }

    /// Dragging across the board walks the game.
    ///
    /// It tracks continuously from where the drag started rather than firing once per
    /// swipe, so a long drag runs through the game and a short one steps a move. A
    /// fourteenth of the board per move is about 27 points on a phone — far enough that a
    /// tap does not move anything, close enough that a thumb can steer it.
    private func walkGesture(stepWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                let anchor = dragAnchor ?? store.cursor
                if dragAnchor == nil { dragAnchor = anchor; store.stopPlay() }
                let steps = Int((value.translation.width / max(stepWidth, 1)).rounded())
                store.seek(to: anchor + steps)
            }
            .onEnded { _ in dragAnchor = nil }
    }

    /// Both players, the side at the bottom of the board first. The owner is at the bottom
    /// by default, because reviewing your own game means seeing it from where you sat, and
    /// flipping the board swaps who is where — in the strip as on the board.
    private var players: some View {
        PlayersRow(
            near: player(white: store.orientation == .white, mirrored: false),
            far: player(white: store.orientation != .white, mirrored: true)
        )
    }

    private func player(white: Bool, mirrored: Bool) -> PlayerRow {
        let game = store.detail?.game ?? summary
        return PlayerRow(
            name: white ? game?.white : game?.black,
            rating: white ? game?.whiteRating : game?.blackRating,
            isWhite: white,
            isOwner: game?.ownerIsWhite == white,
            clock: clock(forWhite: white),
            toMove: store.snapshot.sideToMove == (white ? .white : .black),
            mirrored: mirrored
        )
    }

    /// The way out of a variation.
    ///
    /// It appears only while a line is open, in the middle of the transport, where the
    /// position counter otherwise is: directly under the board, where the thumb already is,
    /// and in place of a number that means little on a line. Putting it in the toolbar
    /// would mean reaching across the board to undo something done on the board. It is a
    /// button rather than a gesture because leaving a line is the one thing a reader must
    /// be able to do without knowing anything.
    private var backToGame: some View {
        Button {
            store.exitLine()
            input.clear()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "arrow.uturn.backward")
                    .font(.system(size: 10, weight: .semibold))
                Text("Back to game")
                    .font(Theme.Font.text(11, weight: .medium))
            }
            .foregroundStyle(Theme.accentInk)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(Theme.accent, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Back to the game")
    }

    /// The clock as it stood at the position on the board: the last time this side stopped
    /// their clock at or before the cursor.
    private func clock(forWhite white: Bool) -> Double? {
        store.moves
            .prefix(store.cursor)
            .last { ($0.color == "white") == white }?
            .clock
    }

    // MARK: Transport

    private var transport: some View {
        HStack(spacing: 0) {
            transportButton("backward.end.fill", enabled: store.cursor > 0 || store.isInLine) { store.toStart() }
            transportButton("chevron.left", enabled: store.canStepBack) { store.step(-1) }

            Spacer(minLength: 0)

            if store.isInLine {
                backToGame
            } else {
                Button {
                    show(.eval)
                } label: {
                    Text(store.positionLabel)
                        .font(Theme.Font.mono(12))
                        .foregroundStyle(Theme.dim)
                        .monospacedDigit()
                }
                .buttonStyle(.plain)
            }

            Spacer(minLength: 0)

            transportButton(store.isPlaying ? "pause.fill" : "play.fill", enabled: !store.isInLine && store.cursor < store.moves.count) {
                store.togglePlay()
            }
            transportButton("chevron.right", enabled: store.canStepForward) { store.step(1) }
            transportButton("forward.end.fill", enabled: !store.isInLine && store.cursor < store.moves.count) { store.toEnd() }
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .frame(height: 38)
        .background(Theme.surface)
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

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            VStack(spacing: 0) {
                Text(store.detail?.game.opening ?? summary?.opening ?? "Game")
                    .font(Theme.Font.text(13, weight: .semibold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(Theme.Font.mono(10))
                    .foregroundStyle(Theme.faint)
                    .lineLimit(1)
            }
        }

        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                store.showHints.toggle()
                Haptics.selectionChanged()
            } label: {
                Image(systemName: store.showHints ? "lightbulb.fill" : "lightbulb")
                    .foregroundStyle(store.showHints ? Theme.accent : Theme.dim)
            }
            .accessibilityLabel(store.showHints ? "Hide hints" : "Show hints")

            Menu {
                Button {
                    store.flip()
                } label: {
                    Label("Flip the board", systemImage: "arrow.up.arrow.down")
                }
                Button {
                    store.toPreviousFlagged()
                } label: {
                    Label("Previous flagged move", systemImage: "arrow.up")
                }
                .disabled(!store.hasPreviousFlagged)
                Button {
                    store.toNextFlagged()
                } label: {
                    Label("Next flagged move", systemImage: "arrow.down")
                }
                .disabled(!store.hasNextFlagged)

                if onPreviousGame != nil || onNextGame != nil {
                    Divider()
                    Button { onPreviousGame?() } label: {
                        Label("Previous game", systemImage: "chevron.left.2")
                    }
                    .disabled(onPreviousGame == nil)
                    Button { onNextGame?() } label: {
                        Label("Next game", systemImage: "chevron.right.2")
                    }
                    .disabled(onNextGame == nil)
                }
            } label: {
                Image(systemName: "ellipsis.circle").foregroundStyle(Theme.dim)
            }
        }
    }

    private var subtitle: String {
        let game = store.detail?.game ?? summary
        var parts: [String] = []
        if let eco = game?.eco { parts.append(eco) }
        if let tc = game?.timeControl { parts.append(Format.timeControl(tc)) }
        parts.append(Format.result(game?.result))
        return parts.joined(separator: " · ")
    }
}
