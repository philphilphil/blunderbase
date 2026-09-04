import XCTest
@testable import Blunderbase

/// Playing moves on the board, and getting back off them.
///
/// A line is a position the server has never seen, so the risk here is not that the board
/// draws the wrong pieces — the replay is already tested — but that everything *around* the
/// board keeps answering as though it were still on the game. A stored classification, an
/// evaluation, a glyph or an engine line shown against a variation is wrong in the way that
/// is hardest to notice: it is a real number about a real position, just not this one.
@MainActor
final class AnalysisLineTests: XCTestCase {

    private var store: GameStore!

    override func setUp() async throws {
        try await super.setUp()
        store = GameStore(
            gameID: 1,
            endpoints: Endpoints(serverURL: URL(string: "https://example.invalid")!)
        )
        store.adopt(try GameFixture.friedLiver())
        // After 5.exd5, Black to move. The game's own move here is the blunder 5…Nxd5.
        store.seek(to: 9)
    }

    // MARK: Starting and leaving

    func testPlayingAMoveStartsALineFromTheCurrentPly() {
        XCTAssertFalse(store.isInLine)
        store.play(uci: "c6a5")

        XCTAssertTrue(store.isInLine)
        XCTAssertEqual(store.lineBase, 9, "the line leaves from where the board was")
        XCTAssertEqual(store.line, ["c6a5"])
        XCTAssertEqual(store.lineIndex, 1)
    }

    func testTheBoardShowsTheLinePositionNotTheGames() {
        let beforeFEN = store.snapshot.fen
        store.play(uci: "c6a5")

        XCTAssertNotEqual(store.snapshot.fen, beforeFEN)
        XCTAssertEqual(store.snapshot.pieces[BoardSquare(algebraic: "a5")!]?.kind, .knight)
        XCTAssertNil(store.snapshot.pieces[BoardSquare(algebraic: "c6")!])
    }

    func testLeavingTheLineReturnsToThePlyItLeftFrom() {
        let gameFEN = store.snapshot.fen
        store.play(uci: "c6a5")
        store.exitLine()

        XCTAssertFalse(store.isInLine)
        XCTAssertEqual(store.cursor, 9)
        XCTAssertEqual(store.snapshot.fen, gameFEN)
    }

    func testAMoveThePositionCannotTakeIsRefused() {
        store.play(uci: "a1a8")
        XCTAssertFalse(store.isInLine, "an impossible move must not open a line")

        store.play(uci: "zzzz")
        XCTAssertFalse(store.isInLine)
    }

    // MARK: What the game says about a position it has never seen

    func testTheStoredLookupsGoQuietInsideALine() {
        XCTAssertNotNil(store.positionMove, "precondition: the game has a move here")
        let lines = store.engineLines.map(\.moveUci)
        store.play(uci: "c6a5")

        XCTAssertNil(store.playedMove)
        XCTAssertNil(store.positionMove)
        XCTAssertTrue(store.maiaMoves.isEmpty)
        // The engine lines are the exception: they stay the lines of the position the
        // line left from, so the reader can keep walking one of them.
        XCTAssertEqual(store.engineLines.map(\.moveUci), lines)
    }

    func testThereIsNoStoredEvaluationForALinePosition() {
        XCTAssertNotNil(store.whiteWin, "precondition: the game has an evaluation here")
        store.play(uci: "c6a5")
        XCTAssertNil(store.whiteWin, "a stored evaluation is about the game, not this board")
        XCTAssertNil(store.scoreLabel)
    }

    func testNoClassificationGlyphIsDrawnOnALineMove() {
        store.seek(to: 10)
        XCTAssertNotNil(store.glyph, "precondition: the blunder wears a glyph")
        store.seek(to: 9)
        store.play(uci: "c6a5")
        XCTAssertNil(store.glyph)
    }

    func testTheOnlyArrowInALineIsTheMoveJustPlayed() {
        store.play(uci: "c6a5")
        XCTAssertEqual(store.arrows.map(\.kind), [.played])
        XCTAssertEqual(store.arrows.first?.from, BoardSquare(algebraic: "c6"))
        XCTAssertEqual(store.arrows.first?.to, BoardSquare(algebraic: "a5"))
    }

    // MARK: Walking a line

    func testSteppingForwardWalksTheLine() {
        store.playLine(["c6a5", "c4b5", "c7c6"])
        XCTAssertEqual(store.lineIndex, 3)

        store.step(-1)
        XCTAssertEqual(store.lineIndex, 2)
        store.step(1)
        XCTAssertEqual(store.lineIndex, 3)
        store.step(1)
        XCTAssertEqual(store.lineIndex, 3, "there is nothing past the end of the line")
    }

    func testSteppingBackOffTheStartOfALineReturnsToTheGame() {
        store.play(uci: "c6a5")
        store.step(-1)
        XCTAssertEqual(store.lineIndex, 0)
        XCTAssertTrue(store.isInLine, "the base of the line is still the line")

        store.step(-1)
        XCTAssertFalse(store.isInLine, "one more step back is the way out")
        XCTAssertEqual(store.cursor, 9)
    }

    func testSeekingToAGameMoveLeavesTheLine() {
        store.play(uci: "c6a5")
        store.seek(to: 4)

        XCTAssertFalse(store.isInLine)
        XCTAssertEqual(store.cursor, 4)
    }

    // MARK: Building on a line

    func testPlayingAWholeVariationAppliesEveryMove() {
        store.playLine(["c6a5", "c4b5", "c7c6"])
        XCTAssertEqual(store.line, ["c6a5", "c4b5", "c7c6"])
        XCTAssertEqual(store.snapshot.pieces[BoardSquare(algebraic: "c6")!]?.kind, .pawn)
    }

    func testAVariationStopsWhereThePositionStopsTakingIt() {
        // The second move is impossible from that position, so only the first survives.
        store.playLine(["c6a5", "h8h1"])
        XCTAssertEqual(store.line, ["c6a5"])
    }

    func testPlayingFromHalfwayDropsTheRestOfTheLine() {
        store.playLine(["c6a5", "c4b5", "c7c6"])
        store.step(-2)
        XCTAssertEqual(store.lineIndex, 1)

        // After 5…Na5 it is White to move, so the replacement has to be a White move.
        // Qf3 is legal here: d1-e2-f3 is clear once the e-pawn and the knight have left.
        store.play(uci: "d1f3")
        XCTAssertEqual(
            store.line, ["c6a5", "d1f3"],
            "the moves that followed the one being replaced no longer follow from anything"
        )
        XCTAssertEqual(store.lineIndex, 2)
    }

    func testTheLineIsWrittenWithTheGamesOwnMoveNumbers() {
        store.playLine(["c6a5", "c4b5"])
        // Ply 9 is White's fifth move, so a line leaving it starts on Black's fifth.
        XCTAssertTrue(store.lineText.hasPrefix("5… Na5"), "got \(store.lineText)")
        XCTAssertTrue(store.lineText.contains("6. Bb5+"), "got \(store.lineText)")
    }

    // MARK: The transport's own reading

    func testTheTransportCountsTheLineWhileOneIsOpen() {
        XCTAssertEqual(store.positionLabel, "9/11")
        store.playLine(["c6a5", "c4b5"])
        XCTAssertEqual(store.positionLabel, "line 2/2")
    }

    func testSteppingIsAlwaysPossibleBackwardsOutOfALine() {
        store.seek(to: 0)
        XCTAssertFalse(store.canStepBack, "at the start of the game there is nowhere back")
        store.play(uci: "e2e4")
        XCTAssertTrue(store.canStepBack, "a line can always be stepped out of")
    }
}

/// Selecting a piece and choosing where it goes.
@MainActor
final class MoveInputTests: XCTestCase {

    private let start = Replay.standardFEN

    func testTappingAPieceSelectsItAndOffersItsSquares() {
        let input = MoveInput()
        let move = input.tapped(BoardSquare(algebraic: "e2")!, fen: start)

        XCTAssertNil(move, "selecting is not yet a move")
        XCTAssertEqual(input.selected, BoardSquare(algebraic: "e2"))
        XCTAssertEqual(input.destinations, [BoardSquare(algebraic: "e3")!, BoardSquare(algebraic: "e4")!])
    }

    func testTappingADestinationCompletesTheMove() {
        let input = MoveInput()
        _ = input.tapped(BoardSquare(algebraic: "e2")!, fen: start)
        let move = input.tapped(BoardSquare(algebraic: "e4")!, fen: start)

        XCTAssertEqual(move?.from, BoardSquare(algebraic: "e2"))
        XCTAssertEqual(move?.to, BoardSquare(algebraic: "e4"))
        XCTAssertNil(input.selected, "the selection is spent")
        XCTAssertTrue(input.destinations.isEmpty)
    }

    func testTappingTheSelectedPieceAgainClearsIt() {
        let input = MoveInput()
        _ = input.tapped(BoardSquare(algebraic: "e2")!, fen: start)
        let move = input.tapped(BoardSquare(algebraic: "e2")!, fen: start)

        XCTAssertNil(move)
        XCTAssertNil(input.selected)
    }

    func testAPieceWithNowhereToGoIsNotSelected() {
        let input = MoveInput()
        // The rook on a1 is boxed in by its own pieces at the start.
        _ = input.tapped(BoardSquare(algebraic: "a1")!, fen: start)
        XCTAssertNil(input.selected)
        XCTAssertTrue(input.destinations.isEmpty)
    }

    func testTheOtherSidesPieceIsNotSelectable() {
        let input = MoveInput()
        _ = input.tapped(BoardSquare(algebraic: "e7")!, fen: start)
        XCTAssertNil(input.selected, "it is White to move")
    }

    func testAPromotionStopsToAskRatherThanPlayingAQueen() {
        let input = MoveInput()
        let fen = "8/4P3/8/8/8/8/8/4K2k w - - 0 1"
        _ = input.tapped(BoardSquare(algebraic: "e7")!, fen: fen)
        let move = input.tapped(BoardSquare(algebraic: "e8")!, fen: fen)

        XCTAssertNil(move, "the move is not decided until a piece is chosen")
        XCTAssertEqual(input.promotion?.from, BoardSquare(algebraic: "e7"))
        XCTAssertEqual(input.promotion?.to, BoardSquare(algebraic: "e8"))
        XCTAssertEqual(input.promotion?.color, .white)

        let chosen = input.choose(.knight)
        XCTAssertEqual(chosen?.promotion, .knight)
        XCTAssertNil(input.promotion)
    }

    func testCancellingAPromotionLeavesNoMove() {
        let input = MoveInput()
        let fen = "8/4P3/8/8/8/8/8/4K2k w - - 0 1"
        _ = input.tapped(BoardSquare(algebraic: "e7")!, fen: fen)
        _ = input.tapped(BoardSquare(algebraic: "e8")!, fen: fen)
        input.cancelPromotion()

        XCTAssertNil(input.promotion)
        XCTAssertNil(input.choose(.queen))
    }
}

/// Turning a touch into a square.
///
/// This mapping is the inverse of the one that positions the pieces, and until moves could
/// be played on the board nothing ever called it — so it has never been wrong in a way
/// anybody would have seen. It is worth pinning because getting it wrong does not look like
/// a crash: it looks like the board selecting the piece next to the one you touched, and on
/// a flipped board it looks like the board working perfectly until you flip it.
final class BoardTapGeometryTests: XCTestCase {

    func testEverySquareRoundTripsThroughItsOwnCentre() {
        for orientation in [PieceColor.white, .black] {
            let geometry = BoardGeometry(squareSize: 40, orientation: orientation)
            for file in 0...7 {
                for rank in 0...7 {
                    guard let square = BoardSquare(file: file, rank: rank) else {
                        return XCTFail("\(file),\(rank) is not a square")
                    }
                    XCTAssertEqual(
                        geometry.square(at: geometry.center(of: square)),
                        square,
                        "\(square.algebraic) with \(orientation.rawValue) at the bottom"
                    )
                }
            }
        }
    }

    func testTheCornersLandWhereTheyLookOnEachOrientation() {
        let size: CGFloat = 40
        let white = BoardGeometry(squareSize: size, orientation: .white)
        // Top-left of a White-at-the-bottom board is a8; bottom-right is h1.
        XCTAssertEqual(white.square(at: CGPoint(x: 1, y: 1)), BoardSquare(algebraic: "a8"))
        XCTAssertEqual(white.square(at: CGPoint(x: size * 8 - 1, y: size * 8 - 1)), BoardSquare(algebraic: "h1"))

        let black = BoardGeometry(squareSize: size, orientation: .black)
        XCTAssertEqual(black.square(at: CGPoint(x: 1, y: 1)), BoardSquare(algebraic: "h1"))
        XCTAssertEqual(black.square(at: CGPoint(x: size * 8 - 1, y: size * 8 - 1)), BoardSquare(algebraic: "a8"))
    }

    func testATouchOutsideTheBoardIsNoSquare() {
        let geometry = BoardGeometry(squareSize: 40, orientation: .white)
        XCTAssertNil(geometry.square(at: CGPoint(x: -1, y: 10)))
        XCTAssertNil(geometry.square(at: CGPoint(x: 10, y: 321)))
    }
}

/// The generator, asked the two questions the board asks it.
final class LegalMoveQueryTests: XCTestCase {

    func testLegalDestinationsExcludeAPinnedPiecesIllegalMoves() {
        // The bishop on e2 is pinned to the king on e1 by the rook on e8.
        let fen = "4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1"
        XCTAssertTrue(
            SAN.legalDestinations(from: BoardSquare(algebraic: "e2")!, fen: fen).isEmpty,
            "a pinned bishop on the pin file has no legal move"
        )
    }

    func testAnEmptyOrEnemySquareOffersNothing() {
        XCTAssertTrue(SAN.legalDestinations(from: BoardSquare(algebraic: "e5")!, fen: Replay.standardFEN).isEmpty)
        XCTAssertTrue(SAN.legalDestinations(from: BoardSquare(algebraic: "e7")!, fen: Replay.standardFEN).isEmpty)
    }

    func testPromotionIsRecognisedOnlyForAPawnReachingTheLastRank() {
        let fen = "8/4P3/8/8/8/8/8/4K2k w - - 0 1"
        XCTAssertTrue(SAN.isPromotion(from: BoardSquare(algebraic: "e7")!, to: BoardSquare(algebraic: "e8")!, fen: fen))
        XCTAssertFalse(SAN.isPromotion(from: BoardSquare(algebraic: "e1")!, to: BoardSquare(algebraic: "e2")!, fen: fen))
    }

    func testMateAndStalemateHaveNoLegalMove() {
        XCTAssertFalse(SAN.hasLegalMove(fen: "7k/5QK1/8/8/8/8/8/8 b - - 0 1"), "back-rank style mate")
        XCTAssertFalse(SAN.hasLegalMove(fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), "stalemate")
        XCTAssertTrue(SAN.hasLegalMove(fen: Replay.standardFEN))
    }
}
