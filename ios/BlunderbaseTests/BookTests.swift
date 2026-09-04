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

    /// A variation is a position no game of the owner's ever reached, so the book is
    /// withheld there like everything else the server said about the game.
    func testThereIsNoBookInsideALine() {
        store.seek(to: 8)
        XCTAssertNotNil(store.bookHere)
        store.playLine(["c4d5"])
        XCTAssertTrue(store.isInLine)
        XCTAssertNil(store.bookHere, "the board is off the game")
        store.exitLine()
        XCTAssertNotNil(store.bookHere, "and back again on the way out")
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
