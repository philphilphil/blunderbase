import Foundation
import Observation

/// A board with no game behind it, and the owner's own history of every position it lands on.
///
/// The web's explorer page (`web/src/routes/explorer`) puts a board beside the owner's move
/// tree; this is the phone's half of it, and only the half that is the owner's — the
/// Lichess reference databases the web page also reads are left in the browser, because a
/// phone screen has room for one table and the one worth carrying is your own games.
///
/// **The line is the state.** Everything else — the board, the notation, the book, the games
/// through the position — is derived from the moves played from the start and how far
/// along them the cursor stands. Playing a move from the middle of the line drops the rest,
/// as the game screen's variation does: moves that no longer follow from each other are
/// not a line.
///
/// **One request per position, and never twice.** The book and the games are asked for
/// together when the board arrives somewhere new, and remembered — including the answer
/// "nothing here", which is the usual one — so walking back and forth over the same squares
/// costs nothing. A held transport key on the game screen once took the server down
/// (`memory/blunderbase-meltdown-root-cause.md`); here every position is one deliberate tap.
@Observable
@MainActor
final class ExplorerStore {

    /// Which of the owner's games the fold counts: all of them, or only those they had one
    /// colour in — the explorer page's colour lens.
    enum Scope: String, CaseIterable, Identifiable {
        case both
        case white
        case black

        var id: String { rawValue }

        var color: PieceColor? {
            switch self {
            case .both: return nil
            case .white: return .white
            case .black: return .black
            }
        }

        var label: String {
            switch self {
            case .both: return String(localized: "All games")
            case .white: return String(localized: "As White")
            case .black: return String(localized: "As Black")
            }
        }
    }

    /// The moves played from the start, as UCI.
    private(set) var line: [String] = []
    /// One position per count: `snapshots[n]` is the board after `n` moves of `line`.
    private(set) var snapshots: [Snapshot] = Replay.snapshots(from: [])
    /// How far along the line the board is. `line.count` is its end.
    private(set) var cursor = 0

    var scope: Scope = .both
    var orientation: PieceColor = .white

    /// What the server said about each position, keyed by position *and* scope, because
    /// the same square answers differently through a different lens. A key with `nil`
    /// under it is "asked, and there is no book here", which is not the same as not asked.
    private var books: [String: BookEntry?] = [:]
    private var occurrences: [String: [PositionOccurrence]] = [:]
    private var pending: Set<String> = []
    /// Why the last lookup failed, or nil. Shown once, in the reader's own words from the
    /// error, with a way to ask again.
    private(set) var failure: String?

    @ObservationIgnored private var endpoints: Endpoints?
    @ObservationIgnored private weak var session: Session?

    func attach(endpoints: Endpoints, session: Session?) {
        self.session = session
        guard self.endpoints == nil else { return }
        self.endpoints = endpoints
    }

    // MARK: The board

    var snapshot: Snapshot {
        snapshots[min(max(0, cursor), snapshots.count - 1)]
    }

    var fen: String { snapshot.fen }

    var isAtStart: Bool { cursor == 0 }
    var canStepBack: Bool { cursor > 0 }
    var canStepForward: Bool { cursor < line.count }

    /// The line written the way a reader would, `1. e4 c5 2. Nf3`, up to the cursor.
    var lineText: String {
        guard cursor > 0 else { return "" }
        return SAN.line(Array(line.prefix(cursor)), from: Replay.standardFEN, limit: cursor)
    }

    /// Play one move from the position on the board. A move that does not apply — a tap
    /// that spelled nothing — leaves everything as it was.
    func play(uci: String) {
        let kept = Array(line.prefix(cursor))
        let proposed = kept + [uci]
        let replayed = Replay.snapshots(
            from: proposed.enumerated().map { ReplayMove(ply: $0.offset + 1, uci: $0.element) }
        )
        // `replayed.count - 1` is how many of the proposed moves actually applied.
        guard replayed.count - 1 == proposed.count else { return }
        line = proposed
        snapshots = replayed
        cursor = proposed.count
        Haptics.step()
    }

    func play(from: BoardSquare, to: BoardSquare, promotion: PieceKind? = nil) {
        var uci = from.algebraic + to.algebraic
        if let promotion { uci += String(promotion.letter) }
        play(uci: uci)
    }

    func step(_ delta: Int) {
        let target = min(max(0, cursor + delta), line.count)
        guard target != cursor else { return }
        cursor = target
        Haptics.step()
    }

    func toStart() { step(-cursor) }
    func toEnd() { step(line.count - cursor) }

    /// Back to the starting position with nothing played: the explorer's "Reset".
    func reset() {
        guard !line.isEmpty || cursor != 0 else { return }
        line = []
        snapshots = Replay.snapshots(from: [])
        cursor = 0
        Haptics.selectionChanged()
    }

    func flip() {
        orientation = orientation.opposite
    }

    // MARK: What the server said about here

    /// The key a position's answers are filed under. Exposed so a view can make one request
    /// per key (`.task(id:)`) rather than per render.
    var key: String { "\(scope.rawValue)|\(fen)" }

    var bookHere: BookEntry? { books[key] ?? nil }
    var gamesHere: [PositionOccurrence] { occurrences[key] ?? [] }
    var isLoadingHere: Bool { pending.contains(key) }
    /// True once the server has answered for this position through this lens, whatever
    /// it said — the difference between "no book here" and "not asked yet".
    var hasAnswerHere: Bool { books.index(forKey: key) != nil }

    /// Take a position's answers that have already been fetched — a preview and a test both
    /// want the table without a server to fake.
    func adopt(book: BookEntry?, games: [PositionOccurrence] = []) {
        books[key] = .some(book)
        occurrences[key] = games
    }

    /// Ask the server about the position on the board, once.
    func loadHere() async {
        guard let endpoints, !hasAnswerHere, !pending.contains(key) else { return }
        let key = self.key
        let fen = self.fen
        let color = scope.color
        pending.insert(key)
        defer { pending.remove(key) }
        do {
            // Both at once: they are two questions about one square, and the reader is
            // waiting on the slower of them either way.
            async let book = endpoints.positionBook(fen: fen, color: color)
            async let games = endpoints.findPositions(fen: fen, color: color)
            let answers = try await (book, games)
            books[key] = .some(answers.0)
            occurrences[key] = answers.1
            failure = nil
        } catch {
            session?.handle(error)
            // Nothing is written, so the next visit — or "try again" — asks again.
            failure = (error as? LocalizedError)?.errorDescription ?? "\(error)"
        }
    }
}
