import XCTest

@testable import Blunderbase

/// Tests for the notation generator.
///
/// Every expected string below was derived by hand from the position — piece by piece, and
/// for the mates by checking each escape square — and then cross-checked against an
/// independent chess library's SAN for the same FEN and UCI. A wrong expectation here is
/// worse than no test: notation is read, not executed, so a bug ships as a line that looks
/// like chess and names the wrong piece.
///
/// The FENs are written out rather than replayed into, so a failure points at one position
/// instead of at a move list that drifted three plies earlier.
final class SANTests: XCTestCase {

    // MARK: Helpers

    private let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

    private func assertSAN(
        _ uci: String,
        _ fen: String,
        _ expected: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertEqual(SAN.san(forUCI: uci, fen: fen), expected, "\(uci) in \(fen)", file: file, line: line)
    }

    // MARK: Plain moves

    func testPawnPushIsJustTheSquare() {
        assertSAN("e2e4", start, "e4")
        assertSAN("d2d3", start, "d3")
    }

    func testPieceMovesCarryTheirLetter() {
        assertSAN("g1f3", start, "Nf3")
        assertSAN("b1c3", start, "Nc3")
        assertSAN("g1h3", start, "Nh3")
    }

    func testBlackMovesFromABlackToMoveFEN() {
        let afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
        assertSAN("e7e5", afterE4, "e5")
        assertSAN("g8f6", afterE4, "Nf6")
    }

    // MARK: Captures

    func testPawnCaptureNamesItsFile() {
        // After 1. e4 d5.
        let fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2"
        assertSAN("e4d5", fen, "exd5")
    }

    func testPieceCaptureIsLetterTimesSquare() {
        // After 1. e4 e5 2. Nf3 Nc6, the knight takes on e5.
        let fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"
        assertSAN("f3e5", fen, "Nxe5")
    }

    func testQueenCapture() {
        // Scholar's mate: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6, and White mates on f7. The knight
        // on f6 attacks h5, d5, e8 and g8 but not f7, which is the whole point of the trap.
        let fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4"
        assertSAN("h5f7", fen, "Qxf7#")
    }

    // MARK: Disambiguation

    func testFileDisambiguation() {
        // Knights on c3 and g1, both reaching e2.
        let fen = "4k3/8/8/8/8/2N5/8/4K1N1 w - - 0 1"
        assertSAN("c3e2", fen, "Nce2")
        assertSAN("g1e2", fen, "Nge2")
    }

    func testRankDisambiguationWhenFilesAreEqual() {
        // Rooks on a1 and a5, both reaching a3 down an empty file.
        let fen = "4k3/8/8/R7/8/8/8/R3K3 w - - 0 1"
        assertSAN("a1a3", fen, "R1a3")
        assertSAN("a5a3", fen, "R5a3")
    }

    func testBothFileAndRankWhenNeitherAloneSuffices() {
        // Three queens bearing on e1: h4 down the diagonal, e4 down the file, h1 along the
        // rank. From h4 the file is shared with h1 and the rank with e4, so the square is
        // the only thing that names it.
        let fen = "6k1/8/8/8/4Q2Q/8/8/K6Q w - - 0 1"
        assertSAN("h4e1", fen, "Qh4e1")
        assertSAN("e4e1", fen, "Qee1")
        assertSAN("h1e1", fen, "Q1e1")
    }

    /// The case a generator that only asks "can it reach the square" gets wrong.
    ///
    /// White knights on c3 and g1 both step to e2, but a black rook on h1 pins the g1 knight
    /// to the king on e1 — so it is not an alternative and must not force a `Nce2`.
    func testPinnedTwinDoesNotForceDisambiguation() {
        let pinned = "4k3/8/8/8/8/2N5/8/4K1Nr w - - 0 1"
        assertSAN("c3e2", pinned, "Ne2")

        // The pinned knight cannot be written at all: moving it is not a legal move.
        XCTAssertNil(SAN.san(forUCI: "g1e2", fen: pinned))

        // Take the rook away and the same move needs the file again — proof the position
        // above differs only in the pin.
        assertSAN("c3e2", "4k3/8/8/8/8/2N5/8/4K1N1 w - - 0 1", "Nce2")
    }

    func testPawnCapturesNeverTakeExtraDisambiguation() {
        // Pawns on c4 and e4 both capture on d5. The file prefix a pawn capture already
        // carries is the disambiguation; adding another would read `ccxd5`.
        let fen = "4k3/8/8/3p4/2P1P3/8/8/4K3 w - - 0 1"
        assertSAN("c4d5", fen, "cxd5")
        assertSAN("e4d5", fen, "exd5")
    }

    // MARK: Castling

    func testWhiteCastling() {
        assertSAN("e1g1", "4k3/8/8/8/8/8/8/4K2R w K - 0 1", "O-O")
        assertSAN("e1c1", "4k3/8/8/8/8/8/8/R3K3 w Q - 0 1", "O-O-O")
    }

    func testBlackCastling() {
        assertSAN("e8g8", "4k2r/8/8/8/8/8/8/4K3 b k - 0 1", "O-O")
        assertSAN("e8c8", "r3k3/8/8/8/8/8/8/4K3 b q - 0 1", "O-O-O")
    }

    func testCastlingUsesLettersNotZeroes() {
        let text = SAN.san(forUCI: "e1g1", fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1")
        XCTAssertEqual(text, "O-O")
        XCTAssertFalse(text?.contains("0") ?? true, "castling is the letter O, not a zero")
    }

    func testIllegalCastlingIsNotWritten() {
        // In check, so the king may not castle out of it.
        XCTAssertNil(SAN.san(forUCI: "e1g1", fen: "4k3/8/8/8/8/8/8/r3K2R w K - 0 1"))
        // f1 is attacked down the file, so the king may not cross it.
        XCTAssertNil(SAN.san(forUCI: "e1g1", fen: "5k2/5r2/8/8/8/8/8/4K2R w K - 0 1"))
        // The right is in the FEN but the rook is not on the board.
        XCTAssertNil(SAN.san(forUCI: "e1g1", fen: "4k3/8/8/8/8/8/8/4K3 w K - 0 1"))
    }

    // MARK: Promotion

    func testPromotion() {
        let fen = "8/4P3/8/k7/8/8/8/4K3 w - - 0 1"
        assertSAN("e7e8q", fen, "e8=Q")
        assertSAN("e7e8n", fen, "e8=N")
        assertSAN("e7e8r", fen, "e8=R")
        assertSAN("e7e8b", fen, "e8=B")
    }

    func testPromotionWithCapture() {
        // The pawn takes the rook on d8 and becomes a queen. The black king sits on h5,
        // off every line the new queen holds, so this move is not a check.
        assertSAN("e7d8q", "3r4/4P3/8/7k/8/8/8/4K3 w - - 0 1", "exd8=Q")
    }

    func testPromotionWithoutALetterIsReadAsAQueen() {
        // Four-character UCI on a promoting move is malformed, but the applier already
        // resolves it to a queen and a truncated line would be the worse answer.
        assertSAN("e7e8", "8/4P3/8/k7/8/8/8/4K3 w - - 0 1", "e8=Q")
    }

    func testPromotionLetterOnANonPromotingMoveIsRejected() {
        XCTAssertNil(SAN.san(forUCI: "e2e4q", fen: start))
    }

    // MARK: En passant

    func testEnPassantIsAnOrdinaryLookingPawnCapture() {
        // After 1. e4 Nf6 2. e5 d5, with d6 as the en-passant target.
        let fen = "rnbqkbnr/ppp1pppp/5n2/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3"
        assertSAN("e5d6", fen, "exd6")
    }

    func testStaleEnPassantTargetIsNotAMove() {
        // The FEN names d6 but no black pawn stands on d5, so there is nothing to take. A
        // stale target is a corrupt FEN, and refusing the move keeps the notation in step
        // with the applier, which will not perform a capture with no captured piece.
        XCTAssertNil(SAN.san(forUCI: "e5d6", fen: "4k3/8/8/4P3/8/8/8/4K3 w - d6 0 1"))
    }

    // MARK: Check and mate

    func testCheckSuffix() {
        // Rh8+ along the eighth rank; the king still has d7, e7 and f7.
        assertSAN("h1h8", "4k3/8/8/8/8/8/8/4K2R w K - 0 1", "Rh8+")
    }

    func testBackRankMate() {
        // The black king is walled in by its own f7, g7 and h7 pawns, and no black piece
        // reaches the eighth rank to take or block the rook.
        assertSAN("a1a8", "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "Ra8#")
    }

    func testStalemateIsNotMate() {
        // After Qg6 the black king on h8 has no move, but it is not in check — so no suffix.
        assertSAN("g5g6", "7k/8/8/6Q1/8/8/8/K7 w - - 0 1", "Qg6")
    }

    // MARK: Rejection

    func testMalformedUCIIsNil() {
        for uci in ["", "e2", "e2e", "e2e45", "zzzz", "0000", "e9e4", "E2E4", "Nf3"] {
            XCTAssertNil(SAN.san(forUCI: uci, fen: start), uci)
        }
    }

    func testMoveOfTheWrongSideIsNil() {
        XCTAssertNil(SAN.san(forUCI: "e7e5", fen: start), "Black to move it is not")
    }

    func testMoveFromAnEmptySquareIsNil() {
        XCTAssertNil(SAN.san(forUCI: "e3e4", fen: start))
    }

    func testIllegalMoveIsNil() {
        // A pawn cannot travel three squares, and a bishop pinned down the e-file cannot
        // step off it and leave its king in check.
        XCTAssertNil(SAN.san(forUCI: "e2e5", fen: start))
        XCTAssertNil(SAN.san(forUCI: "e2d3", fen: "4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1"))
    }

    func testUnparseableFENIsNil() {
        for fen in ["", "not a fen", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1",
                    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1",
                    "rnbqkbnr/ppppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"] {
            XCTAssertNil(SAN.san(forUCI: "e2e4", fen: fen), fen)
        }
    }

    func testTruncatedFENStillWorks() {
        // Four-field FENs turn up in the wild; the clocks are the least load-bearing field.
        assertSAN("e2e4", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", "e4")
    }

    // MARK: Lines

    func testLineNumbersFromWhite() {
        let pv = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]
        XCTAssertEqual(SAN.line(pv, from: start), "1. e4 e5 2. Nf3 Nc6 3. Bc4")
    }

    func testLineStartingOnBlacksTurnUsesTheEllipsis() {
        let afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
        XCTAssertEqual(SAN.line(["e7e5", "g1f3", "b8c6"], from: afterE4), "1… e5 2. Nf3 Nc6")
    }

    func testLineTakesItsNumberFromTheFENNotFromZero() {
        // Move four of a real game, and the line has to say so.
        let fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4"
        XCTAssertEqual(SAN.line(["h5f7"], from: fen), "4. Qxf7#")
    }

    func testLineRespectsTheLimit() {
        let pv = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]
        XCTAssertEqual(SAN.line(pv, from: start, limit: 1), "1. e4")
        XCTAssertEqual(SAN.line(pv, from: start, limit: 2), "1. e4 e5")
        XCTAssertEqual(SAN.line(pv, from: start, limit: 3), "1. e4 e5 2. Nf3")
        XCTAssertEqual(SAN.line(pv, from: start, limit: 99), "1. e4 e5 2. Nf3 Nc6 3. Bc4")
    }

    func testLineWithNoRoomRendersNothing() {
        XCTAssertEqual(SAN.line(["e2e4"], from: start, limit: 0), "")
        XCTAssertEqual(SAN.line(["e2e4"], from: start, limit: -3), "")
        XCTAssertEqual(SAN.line([], from: start), "")
    }

    func testLineTruncatesRatherThanFailing() {
        XCTAssertEqual(SAN.line(["e2e4", "zzzz", "g1f3"], from: start), "1. e4")
        XCTAssertEqual(SAN.line(["e2e4", "e7e5", "e1e8"], from: start), "1. e4 e5")
    }

    func testLineIsEmptyWhenNothingCanBeRendered() {
        XCTAssertEqual(SAN.line(["zzzz", "e2e4"], from: start), "")
        XCTAssertEqual(SAN.line(["e2e4"], from: "not a fen"), "")
    }

    // MARK: Whole variations

    /// A longer line through castling, a capture and a check, so the position carried from
    /// ply to ply is exercised rather than just the first move.
    func testLineThroughCastlingAndCapture() {
        // 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. Nxe5 Nxe5 6. d4.
        let pv = [
            "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5",
            "e1g1", "g8f6", "f3e5", "c6e5", "d2d4",
        ]
        XCTAssertEqual(
            SAN.line(pv, from: start, limit: 11),
            "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. Nxe5 Nxe5 6. d4"
        )
    }

    /// Fool's mate, to prove the `#` survives being rendered inside a line.
    func testLineEndingInMate() {
        XCTAssertEqual(
            SAN.line(["f2f3", "e7e5", "g2g4", "d8h4"], from: start),
            "1. f3 e5 2. g4 Qh4#"
        )
    }
}
