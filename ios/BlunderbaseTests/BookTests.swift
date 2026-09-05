import XCTest
@testable import Blunderbase

/// The one lookup the Book pane turns on, and the scale it is keyed by.
///
/// The book is keyed by half-move **count** — the position after `n` moves — while
/// `MoveRow.ply` is a 0-based move index one lower. The two are always one apart, which is
/// exactly why reading the book at the wrong one shows a real position's real numbers
/// against the wrong board and never throws. These tests pin the count.
@MainActor
final class BookTests: XCTestCase {

    private var store: GameStore!

    override func setUp() async throws {
        try await super.setUp()
        store = GameStore(gameID: 1, endpoints: Endpoints(serverURL: URL(string: "https://example.invalid")!))
        store.adopt(try GameFixture.friedLiver())
    }

    // MARK: Decoding

    func testTheBookDecodesFromStringKeysIntoCounts() throws {
        let book = try XCTUnwrap(store.detail?.book)
        XCTAssertEqual(Set(book.keys), [4, 8], "the wire's \"4\" and \"8\" are counts, not move plies")
        XCTAssertEqual(book[8]?.games, 5)
        XCTAssertEqual(book[8]?.moves?.count, 2)
        XCTAssertEqual(book[8]?.moves?.first?.san, "exd5")
        XCTAssertEqual(book[8]?.moves?.first?.avgWinLoss, 1.4)
        XCTAssertEqual(book[8]?.moves?.last?.ownerMoves, 2)
        XCTAssertNil(book[4]?.moves?.last?.avgWinLoss, "an unevaluated continuation has no drop")
    }

    // MARK: The lookup

    /// Count 8 is the position after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 — the board the
    /// cursor shows at 8, and the move leaving it is the game's own 5.exd5, which is one of
    /// the continuations. That coincidence is what the pane's "played" mark reads.
    func testTheBookAtTheCursorIsTheEntryForThePositionOnTheBoard() {
        store.seek(to: 8)
        let entry = store.bookHere
        XCTAssertEqual(entry?.games, 5)
        XCTAssertEqual(store.positionMove?.uci, "e4d5")
        XCTAssertEqual(entry?.moves?.first?.uci, store.positionMove?.uci)
    }

    func testAPositionWithNoEntryHasNoBook() {
        store.seek(to: 5)
        XCTAssertNil(store.bookHere, "no key for count 5 means no book, not an empty one")
        XCTAssertTrue(store.hasBook, "the game still has a book elsewhere along it")
    }

    /// Tapping a continuation moves the board, so the book that shipped with the game is
    /// about somewhere else and goes with it. What replaces it is asked for; until it
    /// arrives there is nothing, which is what `isLoadingBook` is for.
    func testTheGamesOwnBookDoesNotFollowTheBoardOffTheGame() {
        store.seek(to: 8)
        XCTAssertNotNil(store.bookHere)
        store.play(uci: "c4d5")
        XCTAssertTrue(store.isInLine)
        XCTAssertNil(store.bookHere, "count 8's book describes the position before Bxd5")
        store.exitLine()
        XCTAssertEqual(store.bookHere?.games, 5, "and it is back the moment the board is")
    }

    /// The walk the pane exists for: tap a continuation, get the book of the position it led
    /// to, tap one of *those*. The second tap has to add a move to the line rather than
    /// starting a new one from the game — the bug that made walking a line impossible.
    func testWalkingAContinuationAsksForTheBookOfThePositionItLedTo() async throws {
        let store = try stubbedStore(answering: BookStub.entry)
        store.seek(to: 8)
        store.play(uci: "c4d5")
        await store.loadBookForBoard()

        XCTAssertEqual(BookStub.asked, [store.snapshot.fen], "the board's position, not the game's")
        XCTAssertEqual(store.bookHere?.games, 7)
        XCTAssertEqual(store.bookHere?.moves?.first?.uci, "f6d5")

        store.play(uci: "f6d5")
        XCTAssertEqual(store.line, ["c4d5", "f6d5"], "the second tap goes on with the line")
        XCTAssertEqual(store.lineIndex, 2)
    }

    /// Null is the ordinary answer, and it is an answer: asked once, remembered, and never
    /// asked again as the reader steps back and forth over the same square.
    func testAPositionNoTwoGamesReachedIsAskedForOnce() async throws {
        let store = try stubbedStore(answering: "null")
        store.seek(to: 8)
        store.play(uci: "c4d5")
        await store.loadBookForBoard()
        await store.loadBookForBoard()

        XCTAssertEqual(BookStub.asked.count, 1)
        XCTAssertNil(store.bookHere)
    }

    /// The game's own plies are never asked for. A request per ply while somebody holds the
    /// transport down is the shape that took the server down once already.
    func testThePositionsOfTheGameAreNeverAskedFor() async throws {
        let store = try stubbedStore(answering: BookStub.entry)
        for count in 0...11 {
            store.seek(to: count)
            await store.loadBookForBoard()
        }
        XCTAssertTrue(BookStub.asked.isEmpty)
    }

    private func stubbedStore(answering body: String) throws -> GameStore {
        BookStub.reset(answering: body)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BookStub.self]
        let client = APIClient(
            serverURL: URL(string: "https://example.invalid")!,
            configuration: configuration
        )
        let store = GameStore(gameID: 1, endpoints: Endpoints(client: client))
        store.adopt(try GameFixture.friedLiver())
        return store
    }

    func testAGameWithoutABookSaysSoRatherThanShowingNothing() throws {
        let detail = try APIClient.makeDecoder().decode(
            GameDetail.self,
            from: Data(#"{"game": {"id": 5, "source": "manual"}, "moves": [], "runs": []}"#.utf8)
        )
        store.adopt(detail)
        XCTAssertFalse(store.hasBook)
        XCTAssertNil(store.bookHere)
    }
}

/// A server that answers `/explorer/book` from a string, and writes down what it was asked.
///
/// The tests that need it are about *when* the phone asks and what it does with the answer —
/// once per position, never on the game's own plies, and `null` read as an answer rather
/// than as a failure — and none of that can be pinned without a request actually being made.
/// A `URLProtocol` is how a `URLSession` is given a fake server without the app knowing.
final class BookStub: URLProtocol {

    /// One position's strip, as the server writes it: the phone should read this as the book
    /// of whatever position it asked about.
    static let entry = """
    {"games": 7, "wins": 4, "draws": 1, "losses": 2, "score": 0.6428571,
     "moves": [{"uci": "f6d5", "san": "Nxd5", "games": 4, "wins": 1, "draws": 1, "losses": 2,
                "score": 0.375, "owner_moves": 4, "evaluated": 4, "avg_win_loss": 21.5, "blunders": 3},
               {"uci": "d8d5", "san": "Qxd5", "games": 3, "wins": 3, "draws": 0, "losses": 0,
                "score": 1.0, "owner_moves": 3, "evaluated": 3, "avg_win_loss": 2.2, "blunders": 0}]}
    """

    /// The FENs it was asked about, in order.
    private(set) static var asked: [String] = []
    private static var body = "null"

    static func reset(answering body: String) {
        asked = []
        self.body = body
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.path.hasSuffix("/explorer/book") ?? false
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let fen = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "fen" }?.value
        BookStub.asked.append(fen ?? "")

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(BookStub.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
