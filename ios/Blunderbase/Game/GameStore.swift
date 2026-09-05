import Foundation
import Observation

/// Everything the game screen knows, in one place.
///
/// The screen is several panels looking at the same thing — a board, a move list, an eval
/// strip, an engine pane — and the bug they invite is each panel deciding for itself what
/// "here" means. So there is one cursor, and every panel reads from it.
///
/// **The cursor is a half-move count, not a move index.** Cursor 0 is the starting position;
/// cursor `n` is the position after `n` half-moves. `MoveRow.ply` is the other scale — the
/// move's own 0-based index, so the move at ply `p` is played *from* cursor `p` and *arrives
/// at* cursor `p + 1`. That distinction is the source of the two lookups this whole file
/// turns on:
///
/// - `playedMove` is `moves[cursor - 1]` — the move that *arrived* at this position. Its
///   classification is what earns a glyph on the board and a colour in the ticker.
/// - `positionMove` is `moves[cursor]` — the move that *leaves* it. The server hangs the
///   analysis of a position on the move played from it, so the engine's lines, Maia's
///   distribution and the evaluation of what is on the board all live here, not on the
///   move behind us.
///
/// Getting those two the wrong way round shows a plausible screen that is off by one move
/// everywhere, which is why they are named rather than indexed at each call site. A note's
/// ply is a count too, so it is a cursor as it stands and needs the `- 1` to name its move.
@Observable
@MainActor
final class GameStore {

    // MARK: Loaded state

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    let gameID: Int
    private(set) var state: LoadState = .idle
    private(set) var detail: GameDetail?
    private(set) var snapshots: [Snapshot] = []
    private(set) var notes: [NoteResponse] = []

    /// Where we are in the game. Always clamped to `0...moves.count`.
    var cursor: Int = 0 {
        didSet { if cursor != oldValue { cursorDidChange(from: oldValue) } }
    }

    /// Which side sits at the bottom of the board. Defaults to the owner's side, because
    /// the point of reviewing your own game is to see it from where you sat.
    var orientation: PieceColor = .white

    /// The board's arrows and the engine columns, together, as one switch — the web binds
    /// both to a single "hints" toggle so that turning the advice off actually turns it off
    /// rather than moving it to another panel.
    ///
    /// It starts from the settings screen's preference and is then the reader's for the rest
    /// of the game: the toolbar button changes this game, the setting changes the next one.
    var showHints: Bool = Preferences.showHints

    /// The Maia level being read. Starts at the server's configured target Elo, which is
    /// the level the owner is actually trying to beat.
    var maiaElo: Int?

    /// An engine or Maia line the user tapped, shown as arrows over the board until they
    /// tap it again. Nil most of the time.
    var previewLine: [String]?

    private let endpoints: Endpoints
    private var autoplayTask: Task<Void, Never>?

    init(gameID: Int, endpoints: Endpoints) {
        self.gameID = gameID
        self.endpoints = endpoints
    }

    // MARK: Loading

    func load(maiaTargetElo: Int?) async {
        guard state != .loading else { return }
        state = .loading
        do {
            adopt(try await endpoints.game(id: gameID), maiaTargetElo: maiaTargetElo)
        } catch {
            self.state = .failed((error as? LocalizedError)?.errorDescription ?? "\(error)")
        }
    }

    /// Take a game that has already been fetched.
    ///
    /// Separate from `load` because replaying the moves and settling the orientation is the
    /// interesting half and the fetch is not: a test, a preview and a future prefetch all
    /// want this half without a server, and none of them should have to fake one.
    func adopt(_ detail: GameDetail, maiaTargetElo: Int? = nil) {
        self.detail = detail
        self.notes = detail.notes ?? []
        self.snapshots = Replay.snapshots(from: detail.moves.map {
            ReplayMove(ply: $0.ply, san: $0.san, uci: $0.uci)
        })
        // The owner sits at the bottom, unless the reader asked for White at the bottom
        // always. A game the owner did not play — a reference game — has no side of theirs,
        // and White is the convention to fall back on either way.
        self.orientation = (Preferences.ownerAtBottom && detail.game.ownerIsWhite == false)
            ? .black
            : .white
        self.maiaElo = maiaTargetElo ?? availableMaiaElos.last
        self.cursor = 0
        self.state = .loaded
    }

    // MARK: The analysis line

    /// Moves played on the board that are not in the game, as UCI, from `lineBase`.
    ///
    /// **A line is a different place, not a different game.** While one is open the board
    /// shows a position the server has never seen, so everything the server said — the
    /// classification, the stored engine lines, Maia's distribution, the evaluation — is
    /// about somewhere else and is withheld rather than redrawn against the wrong position.
    /// The live engine is the exception: it follows the board, which is the whole reason it
    /// is worth having here.
    private(set) var line: [String] = []
    /// The cursor the line leaves from. Returning to the game means returning here.
    private(set) var lineBase: Int = 0
    /// How far along the line the board is: 0 is the base position, `line.count` is its end.
    private(set) var lineIndex: Int = 0
    private(set) var lineSnapshots: [Snapshot] = []

    var isInLine: Bool { !line.isEmpty }

    /// The line written the way a reader would: `9… Na5 10. Bb5+`, numbered from the game.
    var lineText: String {
        SAN.line(line, from: gameSnapshot(at: lineBase).fen, limit: line.count)
    }

    /// Play one move on the board, starting a line if the board is still on the game.
    ///
    /// Moves after the current point are dropped rather than kept: playing a different move
    /// from halfway along a line means the rest of that line never happened, and silently
    /// keeping it would leave moves on the board that no longer follow from each other.
    func play(from: BoardSquare, to: BoardSquare, promotion: PieceKind? = nil) {
        var uci = from.algebraic + to.algebraic
        if let promotion { uci += String(promotion.letter) }
        play(uci: uci)
    }

    func play(uci: String) {
        playLine([uci])
    }

    /// Play a whole variation onto the board — what tapping an engine or Maia line does.
    ///
    /// The moves are applied as far as they go and no further: a line the position cannot
    /// take stops where it stops, which is the same rule the game's own replay follows.
    func playLine(_ moves: [String]) {
        guard !moves.isEmpty else { return }
        if !isInLine { lineBase = cursor }
        let kept = isInLine ? Array(line.prefix(lineIndex)) : []
        let proposed = kept + moves
        let base = gameSnapshot(at: lineBase)
        let snapshots = Replay.snapshots(
            from: proposed.enumerated().map { ReplayMove(ply: $0.offset + 1, uci: $0.element) },
            startingFEN: base.fen
        )
        // `snapshots.count - 1` is how many of the proposed moves actually applied.
        let applied = max(0, snapshots.count - 1)
        guard applied > kept.count else { return }

        previewLine = nil
        line = Array(proposed.prefix(applied))
        lineSnapshots = snapshots
        lineIndex = applied
        Haptics.step()
    }

    /// One more move of a variation, which is what tapping a stored engine line does.
    ///
    /// A whole line played at once lands the reader at the end of it, which answers "what
    /// does it look like six moves in" and skips the five positions on the way — and the
    /// way is the part worth reading. So a tap plays the *next* move of the line the board
    /// is already on, and the same row tapped again plays the one after. A line the board
    /// has gone a different way from starts over from the game.
    func step(along pv: [String]) {
        guard !pv.isEmpty else { return }
        let done = progress(along: pv)
        guard done < pv.count else { return }
        if isInLine, done == 0, lineIndex > 0 {
            line = []
            lineSnapshots = []
            lineIndex = 0
        }
        playLine([pv[done]])
    }

    /// How many moves of `pv` are on the board: the line so far when it is the start of
    /// `pv`, and none when the board has gone another way. What lets the pane show which
    /// part of a line has been played and which row the next tap continues.
    func progress(along pv: [String]) -> Int {
        guard isInLine, lineIndex > 0 else { return 0 }
        let played = line.prefix(lineIndex)
        return pv.starts(with: played) ? played.count : 0
    }

    /// Back to the game, at the ply the line left from.
    func exitLine() {
        guard isInLine else { return }
        line = []
        lineSnapshots = []
        lineIndex = 0
        previewLine = nil
        Haptics.selectionChanged()
    }

    /// The position the stored engine lines are about: the board, or on a variation the
    /// game position it left from. See `engineLines`.
    var lineStartFEN: String {
        gameSnapshot(at: isInLine ? lineBase : cursor).fen
    }

    /// The game's own position at a half-move count, ignoring any line. The line is built on
    /// top of it.
    private func gameSnapshot(at count: Int) -> Snapshot {
        if count >= 0, count < snapshots.count { return snapshots[count] }
        return snapshots.first ?? GameStore.emptyBoard
    }

    // MARK: The two lookups

    var moves: [MoveRow] { detail?.moves ?? [] }

    /// The move that arrived at the current position, or nil at the start.
    ///
    /// Nil throughout a line: the moves on the board are not the game's, so there is no
    /// stored row describing them and nothing that would be true to return.
    var playedMove: MoveRow? {
        guard !isInLine, cursor > 0, cursor <= moves.count else { return nil }
        return moves[cursor - 1]
    }

    /// The move played *from* the current position, which is where the server hangs this
    /// position's analysis. Nil at the end of the game, where there is nothing left to play.
    var positionMove: MoveRow? {
        guard !isInLine, cursor >= 0, cursor < moves.count else { return nil }
        return moves[cursor]
    }

    /// The position on the board.
    ///
    /// Before the game has loaded there are no snapshots at all, and the screen still has
    /// to draw something, so this falls back to an empty replay of no moves — the standard
    /// starting array. A board is never blank and never crashes on an out-of-range cursor.
    var snapshot: Snapshot {
        if isInLine, lineIndex >= 0, lineIndex < lineSnapshots.count {
            return lineSnapshots[lineIndex]
        }
        if cursor >= 0, cursor < snapshots.count { return snapshots[cursor] }
        if let first = snapshots.first { return first }
        return GameStore.emptyBoard
    }

    private static let emptyBoard: Snapshot = {
        Replay.snapshots(from: []).first ?? Snapshot(
            ply: 0, pieces: [:], lastMove: nil, sideToMove: .white, fen: Replay.standardFEN
        )
    }()

    /// True when the replay stopped short of the move list, which happens when a move fails
    /// to apply. The screen says so rather than pretending the game ends there.
    var replayIsTruncated: Bool {
        !moves.isEmpty && snapshots.count <= moves.count
    }

    // MARK: Evaluation at the cursor

    /// White's share of the win, 0…100, for the position on the board.
    ///
    /// It is read from the move leaving this position, falling back to the move that
    /// arrived at it once the game is over and there is no move leaving.
    var whiteWin: Double? {
        guard !isInLine else { return nil }
        if let before = positionMove?.whiteWinBefore { return before }
        return playedMove?.whiteWinAfter
    }

    var scoreLabel: String? {
        if let move = positionMove {
            return Format.score(cp: move.evalBeforeCp, mate: move.evalBeforeMate)
        }
        if let move = playedMove {
            return Format.score(cp: move.evalAfterCp, mate: move.evalAfterMate)
        }
        return nil
    }

    /// One point per ply, in White's frame, for the strip and the graph.
    ///
    /// The x axis is the **cursor**, not the move index, so the graph and the cursor rule
    /// drawn over it are on one scale and a point sits where the board shows the position it
    /// describes. A move's evaluation is the one *after* it, so the move at ply `p` plots at
    /// `p + 1`; 0 is a level game at 50, so the curve starts where the eval bar starts
    /// rather than at the first analysed move.
    var curve: [CurvePoint] {
        var points: [CurvePoint] = [CurvePoint(ply: 0, win: 50, classification: nil)]
        for move in moves {
            guard let win = move.whiteWinAfter else { continue }
            points.append(
                CurvePoint(ply: move.ply + 1, win: win, classification: move.classification)
            )
        }
        return points
    }

    var flaggedMoves: [MoveRow] {
        moves.filter(\.isFlagged)
    }

    /// Per-side tallies for the graph header: how many of each flagged class, and the
    /// average win percentage given away per move.
    func tally(forWhite white: Bool) -> Tally {
        let side = moves.filter { ($0.color == "white") == white }
        let losses = side.compactMap(\.winLoss)
        return Tally(
            blunders: side.filter { $0.classification == .blunder }.count,
            mistakes: side.filter { $0.classification == .mistake }.count,
            inaccuracies: side.filter { $0.classification == .inaccuracy }.count,
            averageLoss: losses.isEmpty ? nil : losses.reduce(0, +) / Double(losses.count)
        )
    }

    // MARK: The board's arrows

    /// Up to three standing arrows: what was played, what the engine wanted, and what a
    /// human of the owner's strength would have played.
    ///
    /// **The played move always has an arrow, and advice only appears when it disagrees.**
    /// The move that was played is a fact about the game and the reader needs to see it in
    /// every position; the other two are commentary, and commentary that repeats the fact
    /// is noise. So the engine's arrow is drawn only where it differs from the played move,
    /// and Maia's only where it differs from both — which leaves at most three arrows, each
    /// pointing at a different move, and makes agreement legible by *absence*: one arrow
    /// means everybody agreed.
    ///
    /// A preview line replaces all of them. A preview is a question about one line, and
    /// leaving the standing advice underneath makes five arrows nobody can read.
    var arrows: [BoardArrow] {
        if let preview = previewLine, !preview.isEmpty {
            return previewArrows(preview)
        }

        if isInLine { return lineArrow.map { [$0] } ?? [] }

        var result: [BoardArrow] = []
        if let played = playedArrow { result.append(played) }
        guard showHints, let move = positionMove else { return result }

        func appendIfNew(_ uci: String?, _ kind: BoardArrow.Kind) {
            guard let uci, let arrow = arrow(uci: uci, kind: kind) else { return }
            guard !result.contains(where: { $0.from == arrow.from && $0.to == arrow.to }) else { return }
            result.append(arrow)
        }

        appendIfNew(move.bestMoveUci ?? move.bestLines?.first?.moveUci, .engine)
        appendIfNew(topMaiaMove()?.uci, .maia)
        return result
    }

    /// The last move played on the line, so the board says what just happened here too.
    private var lineArrow: BoardArrow? {
        guard lineIndex > 0, lineIndex <= line.count else { return nil }
        return arrow(uci: line[lineIndex - 1], kind: .played)
    }

    private var playedArrow: BoardArrow? {
        guard let uci = positionMove?.uci else { return nil }
        return arrow(uci: uci, kind: .played)
    }

    private func previewArrows(_ pv: [String]) -> [BoardArrow] {
        // Only the first two plies of a line get an arrow. A whole principal variation drawn
        // at once is a thicket; the first move and the reply are the part a reader is asking
        // about, and the rest is in the pane they tapped.
        pv.prefix(2).enumerated().compactMap { index, uci in
            arrow(uci: uci, kind: .preview, label: index == 0 ? nil : "2")
        }
    }

    private func arrow(uci: String, kind: BoardArrow.Kind, label: String? = nil) -> BoardArrow? {
        guard uci.count >= 4 else { return nil }
        let chars = Array(uci)
        guard let from = BoardSquare(algebraic: String(chars[0...1])),
              let to = BoardSquare(algebraic: String(chars[2...3])) else { return nil }
        return BoardArrow(from: from, to: to, kind: kind, label: label)
    }

    /// The badge on the square a flagged move landed on.
    var glyph: BoardGlyph? {
        guard !isInLine, let move = playedMove, move.isFlagged,
              let uci = move.uci, uci.count >= 4 else { return nil }
        let chars = Array(uci)
        guard let square = BoardSquare(algebraic: String(chars[2...3])) else { return nil }
        // Ink as well as colour: the raw initialiser leaves ink at `Theme.void`, which is a
        // near-black that happens to read on red — right by accident today and wrong the
        // moment the palette moves. `ClassificationStyle` already pairs the two.
        return BoardGlyph(
            square: square,
            text: move.classification.glyph,
            color: move.classification.color,
            ink: move.classification.ink
        )
    }

    // MARK: Maia

    var availableMaiaElos: [Int] {
        let levels = moves.compactMap { $0.maia?.levels.keys }.flatMap { $0 }
        return Array(Set(levels)).sorted()
    }

    /// Maia's ranked guesses at the current position, for the level being read.
    var maiaMoves: [MaiaMove] {
        guard let policy = positionMove?.maia else { return [] }
        let elo = maiaElo ?? policy.levels.keys.sorted().last
        guard let elo, let moves = policy.levels[elo] else { return [] }
        return moves.sorted { ($0.rank ?? .max) < ($1.rank ?? .max) }
    }

    private func topMaiaMove() -> MaiaMove? { maiaMoves.first }

    /// The engine's stored lines, best first.
    ///
    /// On the game they are the lines of the position on the board. On a variation they are
    /// the lines of the position the variation *left the game from*, and only **the ones the
    /// board is still inside**: a line the reader is walking is the one reading that is still
    /// about where they are going, and its score is the score of walking it. A line the board
    /// has left is a real number about a position two moves back, which is the kind of wrong
    /// that is hardest to notice — so playing a move of your own, or walking past the end of
    /// a line, takes the stored numbers away and leaves the live engine as the way to read
    /// the position.
    ///
    /// At the base of a line the board is on the game position again and all of them are
    /// about it, which falls out of `progress` returning 0 there.
    var engineLines: [BestLine] {
        let ply = isInLine ? lineBase : cursor
        guard ply >= 0, ply < moves.count, let lines = moves[ply].bestLines else { return [] }
        let sorted = lines.sorted { ($0.multipv ?? .max) < ($1.multipv ?? .max) }
        guard isInLine else { return sorted }
        return sorted.filter { progress(along: $0.pv ?? []) == lineIndex }
    }

    // MARK: The owner's own book

    /// What the owner's other games did from the position on the board.
    ///
    /// **The book follows the board**, which is what makes tapping a continuation worth
    /// doing: the move is played, the next position's book takes its place, and the reader
    /// walks the opening one row at a time.
    ///
    /// It comes from two places for one reason. The game's own positions ship with the game,
    /// keyed by half-move **count** — the entry under `8` is the tree of the position after
    /// eight half-moves, which is the position cursor 8 shows — because a request per ply
    /// while somebody holds the transport down is the shape that took the server down once
    /// already. A position off the game line is asked for one at a time, by
    /// `loadBookForBoard`, since playing a move of your own is a deliberate act and not a
    /// held key.
    ///
    /// Nil is the common answer either way: a book needs two of the owner's games through
    /// the same position, and nearly every position in a library is reached by exactly one.
    var bookHere: BookEntry? {
        guard isInLine else { return detail?.book?[cursor] }
        return exploredBooks[snapshot.fen] ?? nil
    }

    /// Books asked for by FEN, for positions the game does not carry.
    ///
    /// The value is itself optional and the double optional is the point: a key with `nil`
    /// under it is "asked, and there is no book here", which is not the same as never having
    /// asked, and is what keeps walking back and forth over a square from asking twice.
    private var exploredBooks: [String: BookEntry?] = [:]
    private var bookRequests: Set<String> = []

    /// True while the board's own book is in flight, so the pane can wait rather than say
    /// "you have not been here" and then contradict itself a moment later.
    var isLoadingBook: Bool { bookRequests.contains(snapshot.fen) }

    /// Ask the server for the book of the position on the board.
    ///
    /// Only off the game line — on it the answer already shipped with the game — and only
    /// from the pane that shows it, so a reader who never opens Book never asks. A failed
    /// lookup is not remembered: the next time the pane comes back it tries again, which is
    /// the right answer for a request that failed because the network was gone.
    func loadBookForBoard() async {
        guard isInLine else { return }
        let fen = snapshot.fen
        guard exploredBooks.index(forKey: fen) == nil, !bookRequests.contains(fen) else { return }
        bookRequests.insert(fen)
        defer { bookRequests.remove(fen) }
        do {
            // Remembered even when the answer is "no book here", which it usually is: that
            // is what stops the pane asking again on every step back and forth over the
            // same square.
            exploredBooks[fen] = .some(try await endpoints.positionBook(fen: fen))
        } catch {
            // Nothing is written, so the next visit asks again.
        }
    }

    /// Whether this game carries a book anywhere along it.
    ///
    /// What separates "nothing here" from "nothing at all": a game with a book somewhere
    /// means walking back into the opening will find one, and a game with none means the
    /// library has not yet seen this line twice. Those are different sentences to show, and
    /// only the second one is worth explaining.
    var hasBook: Bool {
        !(detail?.book?.isEmpty ?? true)
    }

    // MARK: Moving about

    /// Go to a position of the game, counted in half-moves as the cursor is. Seeking is a
    /// game move, so it leaves any line first — tapping move 12 means the game's move 12,
    /// not a position twelve deep in a variation.
    func seek(to count: Int) {
        if isInLine { exitLine() }
        cursor = min(max(0, count), max(0, snapshots.count - 1))
    }

    /// One step forward or back.
    ///
    /// Inside a line this walks the line, and stepping back off its first move returns to
    /// the game rather than stopping — the line's start and the game's position are the same
    /// board, so there is nothing to see in stopping there.
    func step(_ delta: Int) {
        guard isInLine else {
            seek(to: cursor + delta)
            return
        }
        let target = lineIndex + delta
        if target < 0 {
            exitLine()
        } else if target <= line.count {
            lineIndex = target
            Haptics.step()
        }
    }

    func toStart() { seek(to: 0) }
    func toEnd() { seek(to: snapshots.count - 1) }

    /// What the transport counts. In a line it counts the line, because that is what
    /// stepping moves through.
    var positionLabel: String {
        isInLine ? "line \(lineIndex)/\(line.count)" : "\(cursor)/\(moves.count)"
    }

    var canStepBack: Bool { isInLine ? true : cursor > 0 }
    var canStepForward: Bool { isInLine ? lineIndex < line.count : cursor < moves.count }

    /// The next move the engine flagged, from wherever we are.
    ///
    /// It lands on the position the mistake was made *from*, not the one it led to: the
    /// question a reader has at a blunder is "what should I have played here", and that is
    /// only answerable from the square before it. The move at ply `p` is played from cursor
    /// `p`, so the ply is the cursor to seek to, unconverted.
    func toNextFlagged() {
        guard let next = flaggedMoves.first(where: { $0.ply > cursor }) else { return }
        seek(to: next.ply)
    }

    func toPreviousFlagged() {
        guard let previous = flaggedMoves.last(where: { $0.ply < cursor }) else { return }
        seek(to: previous.ply)
    }

    var hasNextFlagged: Bool { flaggedMoves.contains { $0.ply > cursor } }
    var hasPreviousFlagged: Bool { flaggedMoves.contains { $0.ply < cursor } }

    func flip() {
        orientation = orientation == .white ? .black : .white
    }

    // MARK: Autoplay

    private(set) var isPlaying = false

    func togglePlay() {
        isPlaying ? stopPlay() : startPlay()
    }

    private func startPlay() {
        guard cursor < snapshots.count - 1 else { return }
        isPlaying = true
        autoplayTask = Task { [weak self] in
            while let self, self.isPlaying, self.cursor < self.snapshots.count - 1 {
                try? await Task.sleep(for: .milliseconds(700))
                guard !Task.isCancelled, self.isPlaying else { return }
                self.step(1)
            }
            self?.isPlaying = false
        }
    }

    func stopPlay() {
        isPlaying = false
        autoplayTask?.cancel()
        autoplayTask = nil
    }

    // MARK: Notes

    var notesForGame: [NoteResponse] {
        notes.sorted { ($0.ply ?? 0) < ($1.ply ?? 0) }
    }

    /// The half-move **counts** that carry a note, so the move list can mark them without a
    /// lookup per row. A note hangs on the position after a move, so the move at ply `p`
    /// wears a dot when this contains `p + 1`.
    var notedPlies: Set<Int> {
        Set(notes.compactMap(\.ply))
    }

    func saveNote(text: String, tags: [String]) async -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        do {
            let note = try await endpoints.createNote(
                text: trimmed,
                tags: tags,
                gameID: gameID,
                ply: cursor > 0 ? cursor : nil
            )
            notes.append(note)
            return true
        } catch {
            return false
        }
    }

    // MARK: Side effects of moving

    private func cursorDidChange(from previous: Int) {
        previewLine = nil
        guard abs(cursor - previous) == 1 else {
            Haptics.step()
            return
        }
        if let move = playedMove, move.isFlagged {
            Haptics.flagged()
        } else if let san = playedMove?.san, san.contains("x") {
            Haptics.capture()
        } else {
            Haptics.step()
        }
    }

    struct Tally: Equatable {
        let blunders: Int
        let mistakes: Int
        let inaccuracies: Int
        let averageLoss: Double?
    }
}

/// One point of the eval curve, in White's frame.
///
/// `ply` is a half-move **count** — the cursor the position sits at — and not a move index,
/// so a chart can put its cursor rule and its points on the same axis.
struct CurvePoint: Identifiable, Equatable {
    let ply: Int
    let win: Double
    let classification: Classification?
    var id: Int { ply }
}
