import XCTest
@testable import Blunderbase

/// The game screen's one cursor, and the two lookups everything reads through it.
///
/// `playedMove` is the move that arrived at the position; `positionMove` is the move that
/// leaves it, and it is where the server hangs the analysis of what is on the board. Swap
/// them and every panel is off by one move while looking entirely plausible — the eval bar
/// shows the previous position's score, the engine recommends a move for a position that
/// has already been left, and nothing throws. These tests exist to make that swap fail
/// loudly.
///
/// The fixture is the Fried Liver trap: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 5.exd5 Nxd5??
/// 6.Nxf7 — a real game shape with a real blunder on a known square.
@MainActor
final class GameStoreTests: XCTestCase {

    private var store: GameStore!

    override func setUp() async throws {
        try await super.setUp()
        store = GameStore(gameID: 1, endpoints: Endpoints(serverURL: URL(string: "https://example.invalid")!))
        store.adopt(try decodeDetail())
    }

    // MARK: The two lookups

    func testAtTheStartNothingHasBeenPlayedAndTheFirstMoveIsWhatLeaves() {
        store.seek(to: 0)
        XCTAssertNil(store.playedMove)
        XCTAssertEqual(store.positionMove?.ply, 1)
        XCTAssertEqual(store.positionMove?.san, "e4")
    }

    func testTheTwoLookupsAreAdjacentAndInThatOrder() {
        store.seek(to: 9)
        XCTAssertEqual(store.playedMove?.san, "exd5", "the move that arrived here")
        XCTAssertEqual(store.positionMove?.san, "Nxd5", "the move that leaves here")
    }

    func testAtTheEndThereIsNoMoveLeavingThePosition() {
        store.toEnd()
        XCTAssertEqual(store.cursor, 11)
        XCTAssertEqual(store.playedMove?.san, "Nxf7")
        XCTAssertNil(store.positionMove)
    }

    // MARK: Evaluation

    func testTheEvalBarReadsThePositionOnTheBoardNotTheMoveBehindIt() {
        store.seek(to: 9)
        // Ply 10 is a black move whose `win_before` is 45 from Black's side, so White's
        // share of this position is 55. Reading `whiteWinAfter` of ply 9 instead would give
        // the same number here only by luck, so the fixture makes them differ.
        XCTAssertEqual(store.whiteWin ?? 0, 55, accuracy: 0.001)
    }

    func testAtTheEndTheEvalFallsBackToTheMoveThatArrived() {
        store.toEnd()
        // Ply 11 is a white move with `win_after` 88, already from White's side.
        XCTAssertEqual(store.whiteWin ?? 0, 88, accuracy: 0.001)
    }

    func testTheCurveStartsLevelSoItBeginsWhereTheEvalBarDoes() {
        XCTAssertEqual(store.curve.first?.ply, 0)
        XCTAssertEqual(store.curve.first?.win ?? 0, 50, accuracy: 0.001)
    }

    func testTheCurveIsInWhitesFrameThroughout() {
        // Ply 10, Black's blunder, has `win_after` 8 from Black's side — a disaster for
        // Black, which in White's frame is 92.
        let point = store.curve.first { $0.ply == 10 }
        XCTAssertEqual(point?.win ?? 0, 92, accuracy: 0.001)
        XCTAssertEqual(point?.classification, .blunder)
    }

    // MARK: The board's marks

    func testTheGlyphSitsOnTheSquareTheFlaggedMoveLandedOn() {
        store.seek(to: 10)
        let glyph = store.glyph
        XCTAssertEqual(glyph?.square, BoardSquare(algebraic: "d5"))
        XCTAssertEqual(glyph?.text, "??")
    }

    func testTheGlyphCarriesItsOwnInkNotTheBoardsBackground() {
        store.seek(to: 10)
        XCTAssertEqual(store.glyph?.color, Theme.blunder)
        XCTAssertEqual(store.glyph?.ink, Theme.blunderInk)
    }

    func testThereIsNoGlyphWhereNothingWasFlagged() {
        store.seek(to: 4)
        XCTAssertNil(store.glyph)
    }

    func testThePlayedMoveAlwaysHasAnArrow() {
        for ply in 0...10 {
            store.seek(to: ply)
            guard store.positionMove != nil else { continue }
            XCTAssertTrue(
                store.arrows.contains { $0.kind == .played },
                "no played arrow at ply \(ply)"
            )
        }
    }

    func testAdviceAgreeingWithThePlayedMoveDrawsNoSecondArrow() {
        store.seek(to: 9)
        // Maia's first choice at this position is Nxd5 — the blunder that was actually
        // played. Agreement must read as one arrow, not two stacked on the same squares.
        XCTAssertEqual(store.maiaMoves.first?.uci, "f6d5")
        XCTAssertEqual(store.positionMove?.uci, "f6d5")
        XCTAssertFalse(store.arrows.contains { $0.kind == .maia })
    }

    func testAdviceDisagreeingWithThePlayedMoveDoesGetAnArrow() {
        store.seek(to: 9)
        let engine = store.arrows.first { $0.kind == .engine }
        // The engine wanted Na5, which is not what was played, so it stands.
        XCTAssertEqual(engine?.from, BoardSquare(algebraic: "c6"))
        XCTAssertEqual(engine?.to, BoardSquare(algebraic: "a5"))
    }

    func testEveryStandingArrowPointsAtADifferentMove() {
        store.seek(to: 9)
        let moves = store.arrows.map { [$0.from, $0.to] }
        XCTAssertEqual(moves.count, Set(moves.map(\.description)).count)
    }

    func testAPreviewReplacesTheStandingAdviceRatherThanAddingToIt() {
        store.seek(to: 9)
        store.previewLine = ["c4f7", "e8e7"]
        XCTAssertEqual(Set(store.arrows.map(\.kind)), [.preview])
        XCTAssertEqual(store.arrows.count, 2)
    }

    func testMovingTheCursorClearsAPreview() {
        store.seek(to: 9)
        store.previewLine = ["c4f7"]
        store.step(1)
        XCTAssertNil(store.previewLine)
    }

    // MARK: Moving about

    func testTheNextFlaggedMoveLandsOnThePositionItWasPlayedFrom() {
        store.seek(to: 0)
        store.toNextFlagged()
        // The blunder is ply 10, so the position it was made from is ply 9.
        XCTAssertEqual(store.cursor, 9)
        XCTAssertEqual(store.positionMove?.san, "Nxd5")
    }

    func testThereIsNoFlaggedMoveBeforeTheFirstOne() {
        store.seek(to: 0)
        XCTAssertFalse(store.hasPreviousFlagged)
        XCTAssertTrue(store.hasNextFlagged)
    }

    func testSeekingIsClampedToTheGameRatherThanCrashing() {
        store.seek(to: 900)
        XCTAssertEqual(store.cursor, 11)
        store.seek(to: -5)
        XCTAssertEqual(store.cursor, 0)
    }

    func testFlippingSwapsWhoIsAtTheBottom() {
        let first = store.orientation
        store.flip()
        XCTAssertNotEqual(store.orientation, first)
    }

    // MARK: Maia

    func testMaiaMovesComeBackRankedForTheChosenLevel() {
        store.seek(to: 9)
        store.maiaElo = 1700
        XCTAssertEqual(store.maiaMoves.map(\.uci), ["f6d5", "d8d5"])
    }

    func testTheLevelsOfferedAreTheOnesTheGameActuallyCarries() {
        XCTAssertEqual(store.availableMaiaElos, [1500, 1700])
    }

    // MARK: Replay

    func testTheBoardMatchesTheMoveListAfterEveryMove() {
        store.toEnd()
        // 6.Nxf7 — the knight from g5 has taken on f7.
        XCTAssertEqual(store.snapshot.pieces[BoardSquare(algebraic: "f7")!]?.kind, .knight)
        XCTAssertEqual(store.snapshot.pieces[BoardSquare(algebraic: "f7")!]?.color, .white)
        XCTAssertNil(store.snapshot.pieces[BoardSquare(algebraic: "g5")!])
        XCTAssertFalse(store.replayIsTruncated)
    }

    // MARK: Walking an engine line

    func testATapPlaysOneMoveOfALineAndTheNextTapTheNext() {
        store.seek(to: 9)
        let pv = store.engineLines.first?.pv ?? []
        XCTAssertEqual(pv, ["c6a5", "c4b5", "c7c6"])

        store.step(along: pv)
        XCTAssertTrue(store.isInLine)
        XCTAssertEqual(store.lineIndex, 1)
        XCTAssertEqual(store.progress(along: pv), 1)

        store.step(along: pv)
        XCTAssertEqual(store.lineIndex, 2)
        XCTAssertEqual(store.progress(along: pv), 2)

        store.step(along: pv)
        store.step(along: pv)
        // The line is three moves long; a fourth tap has nothing left to play.
        XCTAssertEqual(store.lineIndex, 3)
    }

    func testTheEngineLinesStayWhileTheirLineIsBeingWalked() {
        store.seek(to: 9)
        let before = store.engineLines.map(\.moveUci)
        let fen = store.snapshot.fen
        store.step(along: store.engineLines.first?.pv ?? [])
        XCTAssertTrue(store.isInLine)
        XCTAssertNotEqual(store.snapshot.fen, fen)
        XCTAssertEqual(store.engineLines.map(\.moveUci), before)
        XCTAssertEqual(store.lineStartFEN, fen)
    }

    func testTappingAnotherLineStartsOverFromTheGame() {
        store.seek(to: 9)
        let first = store.engineLines[0].pv ?? []
        let second = store.engineLines[1].pv ?? []
        store.step(along: first)
        store.step(along: first)

        store.step(along: second)
        XCTAssertEqual(store.line, ["c8e6"])
        XCTAssertEqual(store.lineIndex, 1)
        XCTAssertEqual(store.progress(along: first), 0)
        XCTAssertEqual(store.progress(along: second), 1)
    }

    // MARK: Fixture

    private func decodeDetail() throws -> GameDetail {
        try GameFixture.friedLiver()
    }
}
