import XCTest

@testable import Blunderbase

/// Tests for the replay, which is the layer where a silent bug corrupts every position on
/// the screen rather than breaking one.
///
/// The expected FENs below were hand-checked square by square — placement, side to move,
/// castling rights, en-passant target, halfmove clock and fullmove number — and then
/// cross-checked against an independent engine's output for the same move lists. A wrong
/// expected FEN is worse than no test, because it locks a bug in.
final class ReplayTests: XCTestCase {

    // MARK: Helpers

    private func moves(_ ucis: [String]) -> [ReplayMove] {
        ucis.enumerated().map { ReplayMove(ply: $0.offset + 1, san: nil, uci: $0.element) }
    }

    private func square(_ algebraic: String, file: StaticString = #filePath, line: UInt = #line)
        throws -> BoardSquare
    {
        try XCTUnwrap(BoardSquare(algebraic: algebraic), algebraic, file: file, line: line)
    }

    // MARK: The starting position

    func testStartingPositionHasThirtyTwoPieces() throws {
        let snapshots = Replay.snapshots(from: [])
        XCTAssertEqual(snapshots.count, 1, "an empty move list is still one position")

        let start = try XCTUnwrap(snapshots.first)
        XCTAssertEqual(start.ply, 0)
        XCTAssertNil(start.lastMove)
        XCTAssertEqual(start.sideToMove, .white)
        XCTAssertEqual(start.pieces.count, 32)
        XCTAssertEqual(start.fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
    }

    func testStartingPositionBackRanks() throws {
        let start = try XCTUnwrap(Replay.snapshots(from: []).first)
        let backRank: [PieceKind] = [.rook, .knight, .bishop, .queen, .king, .bishop, .knight, .rook]

        for (file, kind) in backRank.enumerated() {
            let white = try XCTUnwrap(BoardSquare(file: file, rank: 0))
            let black = try XCTUnwrap(BoardSquare(file: file, rank: 7))
            XCTAssertEqual(start.pieces[white], ChessPiece(kind, .white), "white \(white.algebraic)")
            XCTAssertEqual(start.pieces[black], ChessPiece(kind, .black), "black \(black.algebraic)")

            let whitePawn = try XCTUnwrap(BoardSquare(file: file, rank: 1))
            let blackPawn = try XCTUnwrap(BoardSquare(file: file, rank: 6))
            XCTAssertEqual(start.pieces[whitePawn], ChessPiece(.pawn, .white))
            XCTAssertEqual(start.pieces[blackPawn], ChessPiece(.pawn, .black))
        }

        // Nothing anywhere else.
        for rank in 2...5 {
            for file in 0...7 {
                let empty = try XCTUnwrap(BoardSquare(file: file, rank: rank))
                XCTAssertNil(start.pieces[empty], empty.algebraic)
            }
        }
    }

    // MARK: A real game

    func testItalianReplaysToKnownFENs() {
        let snapshots = Replay.snapshots(from: moves(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]))
        let expected = [
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
            "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
            "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
        ]

        XCTAssertEqual(snapshots.count, expected.count)
        for (ply, fen) in expected.enumerated() {
            XCTAssertEqual(snapshots[ply].fen, fen, "ply \(ply)")
            XCTAssertEqual(snapshots[ply].ply, ply)
        }
    }

    func testSnapshotIndexIsPlyAndCarriesTheMoveSquares() throws {
        let snapshots = Replay.snapshots(from: moves(["e2e4", "e7e5", "g1f3"]))
        XCTAssertEqual(snapshots.count, 4)
        XCTAssertEqual(snapshots[1].sideToMove, .black)
        XCTAssertEqual(snapshots[2].sideToMove, .white)

        let last = try XCTUnwrap(snapshots[3].lastMove)
        XCTAssertEqual(last.from, try square("g1"))
        XCTAssertEqual(last.to, try square("f3"))
        XCTAssertEqual(snapshots[3].pieces[try square("f3")], ChessPiece(.knight, .white))
        XCTAssertNil(snapshots[3].pieces[try square("g1")])
    }

    // MARK: Castling

    func testKingsideCastlingMovesBothPiecesAndClearsRights() throws {
        let start = "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
        let snapshots = Replay.snapshots(from: moves(["e1g1"]), startingFEN: start)
        XCTAssertEqual(snapshots.count, 2)

        let after = snapshots[1]
        XCTAssertEqual(after.pieces[try square("g1")], ChessPiece(.king, .white))
        XCTAssertEqual(after.pieces[try square("f1")], ChessPiece(.rook, .white))
        XCTAssertNil(after.pieces[try square("e1")])
        XCTAssertNil(after.pieces[try square("h1")])
        // White's rights are gone; Black's survive.
        XCTAssertEqual(
            after.fen,
            "rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4"
        )
    }

    func testQueensideCastlingMovesTheRookToD() throws {
        let snapshots = Replay.snapshots(
            from: moves(["e8c8"]),
            startingFEN: "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 3 9"
        )
        let after = snapshots[1]
        XCTAssertEqual(after.pieces[try square("c8")], ChessPiece(.king, .black))
        XCTAssertEqual(after.pieces[try square("d8")], ChessPiece(.rook, .black))
        XCTAssertNil(after.pieces[try square("a8")])
        XCTAssertEqual(after.fen, "2kr3r/8/8/8/8/8/8/R3K2R w KQ - 4 10")
    }

    func testMovingARookClearsOnlyThatSideRight() {
        let snapshots = Replay.snapshots(
            from: moves(["h1g1"]),
            startingFEN: "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"
        )
        XCTAssertEqual(snapshots[1].fen, "r3k2r/8/8/8/8/8/8/R3K1R1 b Qkq - 1 1")
    }

    func testCapturingARookInItsCornerClearsTheOpponentsRight() {
        // The rule everyone forgets: the right dies with the rook, not only when it moves.
        let snapshots = Replay.snapshots(
            from: moves(["h4h8"]),
            startingFEN: "r3k2r/8/8/8/7Q/8/8/R3K2R w KQkq - 0 1"
        )
        XCTAssertEqual(snapshots[1].fen, "r3k2Q/8/8/8/8/8/8/R3K2R b KQq - 0 1")
    }

    func testCastlingWithoutItsRookStopsTheReplay() {
        // Coherent-looking UCI, impossible board: the rook is not there to move.
        let snapshots = Replay.snapshots(
            from: moves(["e1g1"]),
            startingFEN: "4k3/8/8/8/8/8/8/4K3 w - - 0 1"
        )
        XCTAssertEqual(snapshots.count, 1)
    }

    // MARK: En passant

    func testEnPassantRemovesThePawnBesideTheDestination() throws {
        let snapshots = Replay.snapshots(from: moves(["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]))
        XCTAssertEqual(snapshots.count, 6)

        // The target appears when the pawn steps two, and only then.
        XCTAssertEqual(
            snapshots[4].fen,
            "rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3"
        )

        let after = snapshots[5]
        XCTAssertNil(after.pieces[try square("d5")], "the captured pawn is not on the destination")
        XCTAssertNil(after.pieces[try square("e5")])
        XCTAssertEqual(after.pieces[try square("d6")], ChessPiece(.pawn, .white))
        // Target consumed, halfmove clock reset by the capture.
        XCTAssertEqual(
            after.fen,
            "rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3"
        )
    }

    func testASingleStepPawnMoveSetsNoEnPassantTarget() {
        let snapshots = Replay.snapshots(from: moves(["e2e3"]))
        XCTAssertEqual(snapshots[1].fen, "rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
    }

    // MARK: Promotion

    func testPromotionPutsTheNamedPieceOnTheLastRank() throws {
        let snapshots = Replay.snapshots(
            from: moves(["e7e8q"]),
            startingFEN: "k7/4P3/8/8/8/8/8/4K3 w - - 0 1"
        )
        XCTAssertEqual(snapshots[1].pieces[try square("e8")], ChessPiece(.queen, .white))
        XCTAssertNil(snapshots[1].pieces[try square("e7")])
        XCTAssertEqual(snapshots[1].fen, "k3Q3/8/8/8/8/8/8/4K3 b - - 0 1")
    }

    func testUnderpromotionAndBlackPromotion() throws {
        let knight = Replay.snapshots(
            from: moves(["e7e8n"]),
            startingFEN: "k7/4P3/8/8/8/8/8/4K3 w - - 0 1"
        )
        XCTAssertEqual(knight[1].pieces[try square("e8")], ChessPiece(.knight, .white))

        let black = Replay.snapshots(
            from: moves(["d2d1r"]),
            startingFEN: "4k3/8/8/8/8/8/3p4/7K b - - 0 1"
        )
        XCTAssertEqual(black[1].pieces[try square("d1")], ChessPiece(.rook, .black))
        XCTAssertEqual(black[1].fen, "4k3/8/8/8/8/8/8/3r3K w - - 0 2")
    }

    func testPromotionLetterOnANonPromotingMoveStopsTheReplay() {
        XCTAssertEqual(Replay.snapshots(from: moves(["e2e4q"])).count, 1)
    }

    // MARK: Totality

    func testAMalformedUCIStopsTheReplayAndKeepsWhatCameBefore() {
        let snapshots = Replay.snapshots(from: moves(["e2e4", "e7e5", "zz9x", "g1f3"]))
        XCTAssertEqual(snapshots.count, 3, "the start plus the two moves that decoded")
        XCTAssertEqual(
            snapshots[2].fen,
            "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2"
        )
    }

    func testAMissingUCIStopsTheReplay() {
        let snapshots = Replay.snapshots(from: [
            ReplayMove(ply: 1, san: "e4", uci: "e2e4"),
            ReplayMove(ply: 2, san: "e5", uci: nil),
            ReplayMove(ply: 3, san: "Nf3", uci: "g1f3"),
        ])
        XCTAssertEqual(snapshots.count, 2)
    }

    func testAMoveWithNoPieceOnTheFromSquareStopsTheReplay() {
        XCTAssertEqual(Replay.snapshots(from: moves(["e2e4", "e2e4"])).count, 2)
        XCTAssertEqual(Replay.snapshots(from: moves(["e5e6"])).count, 1)
    }

    func testMovingTheWrongSideStopsTheReplay() {
        // Two white moves in a row: the move list has desynced from the position.
        XCTAssertEqual(Replay.snapshots(from: moves(["e2e4", "d2d4"])).count, 2)
    }

    func testCapturingYourOwnPieceStopsTheReplay() {
        XCTAssertEqual(Replay.snapshots(from: moves(["b1d2"])).count, 1)
    }

    func testNullAndShortUCIsAreRejected() {
        for uci in ["", "e2", "e2e", "0000", "e2e9", "e2e4k", "e2e4qq", "E2E4"] {
            XCTAssertEqual(Replay.snapshots(from: moves([uci])).count, 1, uci)
        }
    }

    func testAnUnparseableStartingFENYieldsNoSnapshots() {
        // No honest position to draw, so nothing is drawn — callers clamp to `count`.
        XCTAssertEqual(Replay.snapshots(from: moves(["e2e4"]), startingFEN: "nonsense").count, 0)
        XCTAssertEqual(Replay.snapshots(from: [], startingFEN: "8/8/8 w - - 0 1").count, 0)
        XCTAssertEqual(
            Replay.snapshots(from: [], startingFEN: "rnbqkbnr/ppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w").count,
            0,
            "a rank that does not add up to eight"
        )
    }

    func testANonStandardStartingPositionIsHonoured() throws {
        let start = "8/8/4k3/8/8/8/4P3/4K3 w - - 12 40"
        let snapshots = Replay.snapshots(from: moves(["e2e4"]), startingFEN: start)
        XCTAssertEqual(snapshots[0].fen, start)
        XCTAssertEqual(snapshots[0].pieces.count, 3)
        XCTAssertEqual(snapshots[1].fen, "8/8/4k3/8/4P3/8/8/4K3 b - e3 0 40")
    }

    func testTheHalfmoveClockCountsQuietMoves() {
        // Four quiet knight moves: the clock climbs and the fullmove number turns twice.
        let snapshots = Replay.snapshots(
            from: moves(["g1f3", "g8f6", "f3g1", "f6g8"]),
            startingFEN: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 7 20"
        )
        XCTAssertEqual(snapshots[4].fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 11 22")
    }

    // MARK: Squares

    func testEverySquareRoundTrips() throws {
        for rank in 0...7 {
            for file in 0...7 {
                let square = try XCTUnwrap(BoardSquare(file: file, rank: rank))
                XCTAssertEqual(BoardSquare(algebraic: square.algebraic), square, square.algebraic)
            }
        }
        XCTAssertEqual(BoardSquare.all.count, 64)
        XCTAssertEqual(try square("a1").algebraic, "a1")
        XCTAssertEqual(try square("h8").algebraic, "h8")
        XCTAssertEqual(try square("e4").file, 4)
        XCTAssertEqual(try square("e4").rank, 3)
    }

    func testMalformedSquaresAreRejected() {
        for text in ["j9", "", "e", "e0", "e9", "a0", "i1", "4e", "e44", " e4", "E4"] {
            XCTAssertNil(BoardSquare(algebraic: text), text)
        }
        XCTAssertNil(BoardSquare(file: -1, rank: 0))
        XCTAssertNil(BoardSquare(file: 8, rank: 0))
        XCTAssertNil(BoardSquare(file: 0, rank: 8))
    }

    func testSquareColours() throws {
        XCTAssertFalse(try square("a1").isLight)
        XCTAssertTrue(try square("h1").isLight)
        XCTAssertTrue(try square("a8").isLight)
        XCTAssertFalse(try square("h8").isLight)
    }

    // MARK: Geometry

    func testGeometryPlacesSquaresAndFlipsWithOrientation() throws {
        let white = BoardGeometry(fitting: CGSize(width: 320, height: 320), orientation: .white)
        XCTAssertEqual(white.squareSize, 40)
        XCTAssertEqual(white.center(of: try square("a8")), CGPoint(x: 20, y: 20))
        XCTAssertEqual(white.center(of: try square("h1")), CGPoint(x: 300, y: 300))

        let black = BoardGeometry(fitting: CGSize(width: 320, height: 320), orientation: .black)
        XCTAssertEqual(black.center(of: try square("a8")), CGPoint(x: 300, y: 300))
        XCTAssertEqual(black.center(of: try square("h1")), CGPoint(x: 20, y: 20))
    }

    func testGeometryHitTesting() throws {
        let geometry = BoardGeometry(fitting: CGSize(width: 320, height: 320))
        XCTAssertEqual(geometry.square(at: CGPoint(x: 5, y: 5)), try square("a8"))
        XCTAssertEqual(geometry.square(at: CGPoint(x: 315, y: 315)), try square("h1"))
        XCTAssertNil(geometry.square(at: CGPoint(x: -1, y: 10)))
        XCTAssertNil(geometry.square(at: CGPoint(x: 10, y: 321)))
    }

    func testGeometryCentresANonSquareRectangle() {
        let geometry = BoardGeometry(fitting: CGSize(width: 400, height: 320))
        XCTAssertEqual(geometry.squareSize, 40)
        XCTAssertEqual(geometry.origin, CGPoint(x: 40, y: 0), "the board is centred, never stretched")
    }

    // MARK: Piece assets

    func testEveryPieceHasAnAssetName() {
        var names: Set<String> = []
        for color in PieceColor.allCases {
            for kind in PieceKind.allCases {
                names.insert(PieceImage.assetName(for: ChessPiece(kind, color)))
            }
        }
        XCTAssertEqual(names.count, 12, "twelve distinct imagesets")
        XCTAssertTrue(names.contains("piece-wp"))
        XCTAssertTrue(names.contains("piece-bk"))
    }
}
