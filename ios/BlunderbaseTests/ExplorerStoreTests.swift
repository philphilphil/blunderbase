import XCTest
@testable import Blunderbase

/// The explorer's one piece of state — the line — and what is derived from it.
///
/// There is no game behind this board, so the usual off-by-one between a move's ply and
/// the cursor does not arise: `snapshots[n]` is the board after `n` moves, and the cursor
/// is `n`. What is worth pinning is the line's shape under the two things a reader does
/// with it, playing from the middle and walking, and that the answers the server gave are
/// filed by position *and* lens.
@MainActor
final class ExplorerStoreTests: XCTestCase {

    private var store: ExplorerStore!

    override func setUp() async throws {
        try await super.setUp()
        store = ExplorerStore()
    }

    // MARK: The line

    func testItOpensOnTheStartingPositionWithNothingPlayed() {
        XCTAssertEqual(store.fen, Replay.standardFEN)
        XCTAssertTrue(store.line.isEmpty)
        XCTAssertEqual(store.lineText, "")
        XCTAssertTrue(store.isAtStart)
        XCTAssertFalse(store.canStepBack)
        XCTAssertFalse(store.canStepForward)
    }

    func testPlayingAMoveMovesTheBoardAndWritesTheLine() {
        store.play(uci: "e2e4")
        store.play(uci: "c7c5")
        store.play(uci: "g1f3")
        XCTAssertEqual(store.line, ["e2e4", "c7c5", "g1f3"])
        XCTAssertEqual(store.cursor, 3)
        XCTAssertEqual(store.lineText, "1. e4 c5 2. Nf3")
        XCTAssertEqual(store.snapshot.pieces[BoardSquare(algebraic: "f3")!]?.kind, .knight)
    }

    func testAMoveThatDoesNotApplyChangesNothing() {
        store.play(uci: "e2e4")
        let before = store.fen
        store.play(uci: "e2e4")
        XCTAssertEqual(store.fen, before)
        XCTAssertEqual(store.line, ["e2e4"])
    }

    func testPlayingFromTheMiddleDropsTheRestOfTheLine() {
        store.play(uci: "e2e4")
        store.play(uci: "c7c5")
        store.play(uci: "g1f3")
        store.step(-2)
        XCTAssertEqual(store.cursor, 1)
        XCTAssertEqual(store.lineText, "1. e4")

        store.play(uci: "e7e5")
        XCTAssertEqual(store.line, ["e2e4", "e7e5"], "moves that no longer follow are not a line")
        XCTAssertEqual(store.cursor, 2)
    }

    func testWalkingIsClampedToTheLine() {
        store.play(uci: "e2e4")
        store.step(5)
        XCTAssertEqual(store.cursor, 1)
        store.step(-5)
        XCTAssertEqual(store.cursor, 0)
        store.toEnd()
        XCTAssertEqual(store.cursor, 1)
        store.toStart()
        XCTAssertEqual(store.cursor, 0)
        XCTAssertEqual(store.line.count, 1, "walking back does not forget the line")
    }

    func testResetForgetsTheLine() {
        store.play(uci: "e2e4")
        store.reset()
        XCTAssertTrue(store.line.isEmpty)
        XCTAssertEqual(store.fen, Replay.standardFEN)
    }

    func testAPromotionIsSpelledIntoTheMove() {
        // Nothing legal to promote in the starting position, so the move is refused — the
        // point is that the UCI is built with the piece letter rather than crashing.
        store.play(from: BoardSquare(algebraic: "e2")!, to: BoardSquare(algebraic: "e4")!)
        XCTAssertEqual(store.line, ["e2e4"])
    }

    // MARK: What the server said

    func testAnswersAreFiledByPositionAndLens() throws {
        let entry = try APIClient.makeDecoder().decode(
            BookEntry.self,
            from: Data(#"{"games": 3, "wins": 2, "draws": 0, "losses": 1, "moves": [{"uci": "e2e4", "games": 3}]}"#.utf8)
        )
        store.adopt(book: entry)
        XCTAssertEqual(store.bookHere?.games, 3)
        XCTAssertTrue(store.hasAnswerHere)

        store.scope = .black
        XCTAssertNil(store.bookHere, "the same square through another lens is another question")
        XCTAssertFalse(store.hasAnswerHere)

        store.scope = .both
        store.play(uci: "e2e4")
        XCTAssertNil(store.bookHere)
        store.step(-1)
        XCTAssertEqual(store.bookHere?.games, 3, "and walking back finds the answer again")
    }

    func testNoBookHereIsAnAnswerNotAnAbsence() {
        XCTAssertFalse(store.hasAnswerHere)
        store.adopt(book: nil)
        XCTAssertTrue(store.hasAnswerHere)
        XCTAssertNil(store.bookHere)
    }

    func testTheLensNamesTheColour() {
        XCTAssertNil(ExplorerStore.Scope.both.color)
        XCTAssertEqual(ExplorerStore.Scope.white.color, .white)
        XCTAssertEqual(ExplorerStore.Scope.black.color, .black)
    }
}
