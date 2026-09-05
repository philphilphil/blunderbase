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
/// The other scale in play is `MoveRow.ply`, which the backend numbers **from zero**: the
/// move at ply `p` is played from cursor `p` and arrives at cursor `p + 1`. The two are one
/// apart, which is exactly why reading one as the other passes every eyeball test.
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
        XCTAssertEqual(store.positionMove?.ply, 0, "the backend numbers plies from zero")
        XCTAssertEqual(store.positionMove?.san, "e4")
    }

    /// The move at ply `p` is played *from* cursor `p` and arrives *at* cursor `p + 1`.
    ///
    /// Every pane converts between the two — the move list seeks to the arrival, the flagged
    /// list seeks to the departure — so the relationship is worth pinning once, over the
    /// whole game, rather than at one hand-picked ply where an off-by-one might not show.
    func testEveryMoveIsPlayedFromItsOwnPlyAndArrivesAtTheNext() {
        for move in store.moves {
            store.seek(to: move.ply)
            XCTAssertEqual(store.positionMove?.san, move.san, "ply \(move.ply) leaves cursor \(move.ply)")
            store.seek(to: move.ply + 1)
            XCTAssertEqual(store.playedMove?.san, move.san, "ply \(move.ply) arrives at cursor \(move.ply + 1)")
        }
    }

    /// What tapping a row of the move list does: it lands on the position the move made.
    func testTappingAMoveInTheListLandsAfterIt() {
        // 5…Nxd5 is ply 9, so its row seeks to 10 and the board shows the knight on d5.
        let blunder = store.moves.first { $0.san == "Nxd5" }
        XCTAssertEqual(blunder?.ply, 9)
        store.seek(to: 9 + 1)
        XCTAssertEqual(store.playedMove?.san, "Nxd5")
        XCTAssertEqual(store.snapshot.pieces[BoardSquare(algebraic: "d5")!]?.kind, .knight)
        XCTAssertEqual(store.snapshot.pieces[BoardSquare(algebraic: "d5")!]?.color, .black)
    }

    /// The parity the move list pairs rows by, and the numbering `Format` spells.
    func testAnEvenPlyIsWhitesAndIsNumberedFromZero() {
        let opening = store.moves.prefix(4)
        XCTAssertEqual(opening.map(\.ply), [0, 1, 2, 3])
        XCTAssertEqual(opening.map(\.isWhiteMove), [true, false, true, false])
        XCTAssertEqual(opening.map { $0.moveNumber ?? -1 }, [1, 1, 2, 2])
        XCTAssertEqual(opening.map { $0.ply / 2 + 1 }, [1, 1, 2, 2], "the move list pairs on this")

        let blunder = store.moves.first { $0.san == "Nxd5" }
        XCTAssertEqual(Format.move(ply: blunder?.ply ?? -1, san: blunder?.san), "5… Nxd5")
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
        // Ply 9 is Black's blunder, and its `win_before` is 45 from Black's side, so White's
        // share of this position is 55. Reading `whiteWinAfter` of ply 8 instead would give
        // the same number here only by luck, so the fixture makes them differ.
        XCTAssertEqual(store.whiteWin ?? 0, 55, accuracy: 0.001)
    }

    func testAtTheEndTheEvalFallsBackToTheMoveThatArrived() {
        store.toEnd()
        // Ply 10 is a white move with `win_after` 88, already from White's side.
        XCTAssertEqual(store.whiteWin ?? 0, 88, accuracy: 0.001)
    }

    func testTheCurveStartsLevelSoItBeginsWhereTheEvalBarDoes() {
        XCTAssertEqual(store.curve.first?.ply, 0)
        XCTAssertEqual(store.curve.first?.win ?? 0, 50, accuracy: 0.001)
    }

    func testTheCurveIsInWhitesFrameThroughout() {
        // The blunder is ply 9 and its evaluation is the one *after* it, so its point sits
        // at count 10. `win_after` is 8 from Black's side — a disaster for Black, which in
        // White's frame is 92.
        let point = store.curve.first { $0.ply == 10 }
        XCTAssertEqual(point?.win ?? 0, 92, accuracy: 0.001)
        XCTAssertEqual(point?.classification, .blunder)
    }

    /// The graph's x axis is the cursor, so its drop has to fall where the board shows the
    /// blunder. Plotting a point at the move's own ply would put it one half-move early —
    /// still a plausible-looking curve, and the cursor rule would sit beside the drop
    /// instead of on it.
    func testTheCurvesDropSitsAtTheCountWhereTheBoardShowsTheGlyph() {
        let count = store.curve.first { $0.classification == .blunder }?.ply
        XCTAssertEqual(count, 10)

        store.seek(to: count ?? -1)
        XCTAssertEqual(store.playedMove?.san, "Nxd5", "the board is showing the flagged move")
        XCTAssertEqual(store.glyph?.text, "??")
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
        for count in 0...10 {
            store.seek(to: count)
            guard store.positionMove != nil else { continue }
            XCTAssertTrue(
                store.arrows.contains { $0.kind == .played },
                "no played arrow at cursor \(count)"
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
        // The blunder is ply 9, and a move is played *from* the cursor of its own ply — so
        // this is the position before it, with the blunder as the move that leaves.
        XCTAssertEqual(store.cursor, 9)
        XCTAssertEqual(store.positionMove?.san, "Nxd5")
        XCTAssertEqual(store.playedMove?.san, "exd5", "one short of the blunder, not past it")
    }

    func testThereIsNoFlaggedMoveBeforeTheFirstOne() {
        store.seek(to: 0)
        XCTAssertFalse(store.hasPreviousFlagged)
        XCTAssertTrue(store.hasNextFlagged)
    }

    /// Standing on the position a blunder was made from, the blunder is not "next" — it is
    /// where the reader already is — and it is not "previous" either.
    func testTheFlaggedMoveYouAreStandingOnIsNeitherNextNorPrevious() {
        store.seek(to: 9)
        XCTAssertFalse(store.hasNextFlagged)
        XCTAssertFalse(store.hasPreviousFlagged)

        store.seek(to: 10)
        XCTAssertTrue(store.hasPreviousFlagged, "it is behind us once it has been played")
        store.toPreviousFlagged()
        XCTAssertEqual(store.cursor, 9)
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

    /// The line being walked stays, and it is the only one that does: the others are scores
    /// for moves that are not playable from the board any more.
    func testTheEngineLineBeingWalkedIsTheOneThatStays() {
        store.seek(to: 9)
        XCTAssertEqual(store.engineLines.count, 2, "precondition")
        let fen = store.snapshot.fen
        store.step(along: store.engineLines.first?.pv ?? [])

        XCTAssertTrue(store.isInLine)
        XCTAssertNotEqual(store.snapshot.fen, fen)
        XCTAssertEqual(store.engineLines.map(\.moveUci), [Optional("c6a5")])
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
