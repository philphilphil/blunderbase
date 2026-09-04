import Foundation

/// Replaying a game from its move list, because the API never sends a position.
///
/// A game arrives as moves — SAN for the reader, UCI for the machine — and nothing else.
/// There is no FEN per ply, so the phone cannot draw ply 34 without having played the
/// preceding 33. This file does that once, up front: hand it the moves and it hands back
/// one `Snapshot` per ply, index == ply, and every screen afterwards is a subscript.
///
/// **Totality is the contract.** A replay never throws and never traps. A missing UCI, a
/// string that is not a square, a move whose piece is not there, a list that runs past the
/// end of the game — each *stops* the replay and returns the snapshots built so far. A
/// game whose move list half-decodes still shows its opening, which is the right failure
/// for a reader: a board with the first twelve moves on it beats an error page. Callers
/// must therefore treat `snapshots.count` as authoritative and clamp their ply to it,
/// rather than assuming `moves.count + 1`.
///
/// The applier is self-contained rather than a call into ChessKit. See the note on
/// `Position.apply` for why.

// MARK: - Input

/// One move as the API gives it. The app's own minimal shape, so this layer compiles and
/// tests without the API client.
///
/// `uci` is the authoritative form: it names both squares outright, where SAN would need
/// full move generation to resolve. SAN is carried through only so a caller can label a
/// move; the replay never reads it.
public struct ReplayMove: Sendable, Hashable {
    /// Whatever the caller numbers this move — a `MoveRow.ply`, an array offset. The replay
    /// uses the array order rather than this field, so a list with wrong or missing ply
    /// numbers still replays; the field is here because every caller already has one and
    /// carrying it costs nothing.
    public let ply: Int
    public let san: String?
    /// `"e2e4"`, `"e7e8q"`. Nil stops the replay.
    public let uci: String?

    public init(ply: Int, san: String? = nil, uci: String? = nil) {
        self.ply = ply
        self.san = san
        self.uci = uci
    }
}

// MARK: - Output

/// The two squares of the move that produced a position.
///
/// A struct rather than the tuple this obviously wants to be, so `Snapshot` can be
/// `Equatable` — which is what lets SwiftUI diff one ply against the next.
public struct LastMove: Sendable, Hashable {
    public let from: BoardSquare
    public let to: BoardSquare

    public init(from: BoardSquare, to: BoardSquare) {
        self.from = from
        self.to = to
    }
}

/// A drawable position: everything the board needs and nothing it does not.
///
/// The piece map is keyed by square because that is how a board is drawn and how a tap is
/// resolved. The FEN is carried alongside for the things that need a position as a string
/// — an engine request, a share sheet, a copy button — so nothing downstream has to
/// re-serialise and risk disagreeing with what is on screen.
public struct Snapshot: Sendable, Equatable {
    /// 0 is the starting position, before any move.
    public let ply: Int
    public let pieces: [BoardSquare: ChessPiece]
    /// The move that led here; nil at ply 0. The board tints both squares.
    public let lastMove: LastMove?
    public let sideToMove: PieceColor
    public let fen: String

    public init(
        ply: Int,
        pieces: [BoardSquare: ChessPiece],
        lastMove: LastMove?,
        sideToMove: PieceColor,
        fen: String
    ) {
        self.ply = ply
        self.pieces = pieces
        self.lastMove = lastMove
        self.sideToMove = sideToMove
        self.fen = fen
    }
}

// MARK: - Replay

public enum Replay {

    /// The FEN every standard game starts from.
    public static let standardFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

    /// Replays `moves` and returns one snapshot per position, starting with the position
    /// before any move. `result[ply]` is the position after `ply` half-moves.
    ///
    /// - Parameter startingFEN: a non-standard start, for the day a Chess960 or
    ///   set-up-position game arrives. Nil means the standard array. A FEN that cannot be
    ///   parsed returns an *empty* array rather than a wrong board — there is no honest
    ///   position to show, and an empty result is something a caller can see.
    /// - Returns: `moves.count + 1` snapshots for a game that replays cleanly, fewer when
    ///   a move could not be applied. Never throws.
    public static func snapshots(from moves: [ReplayMove], startingFEN: String? = nil) -> [Snapshot] {
        guard var position = Position(fen: startingFEN ?? standardFEN) else { return [] }

        var result: [Snapshot] = [position.snapshot(ply: 0, lastMove: nil)]
        result.reserveCapacity(moves.count + 1)

        for (index, move) in moves.enumerated() {
            guard let uci = move.uci, let parsed = UCIMove(uci) else { break }
            guard position.apply(parsed) else { break }
            result.append(
                position.snapshot(ply: index + 1, lastMove: LastMove(from: parsed.from, to: parsed.to))
            )
        }

        return result
    }
}

// MARK: - UCI

/// A parsed long-algebraic move: two squares and an optional promotion.
///
/// Parsing is separate from applying so that "this string is not a move" and "this move
/// does not fit this position" stay two different failures — both stop the replay, but
/// only one of them means the game data is corrupt rather than merely truncated.
struct UCIMove: Hashable {
    let from: BoardSquare
    let to: BoardSquare
    let promotion: PieceKind?

    /// Accepts exactly `e2e4` or `e7e8q`. Anything else — a null move `0000`, a SAN string
    /// that wandered into the UCI field, a five-character string ending in `k` — is nil.
    init?(_ uci: String) {
        guard uci.count == 4 || uci.count == 5 else { return nil }
        let characters = Array(uci)
        guard let from = BoardSquare(algebraic: String(characters[0...1])),
            let to = BoardSquare(algebraic: String(characters[2...3]))
        else { return nil }
        if characters.count == 5 {
            guard let kind = PieceKind(letter: characters[4]),
                kind != .pawn, kind != .king
            else { return nil }
            self.promotion = kind
        } else {
            self.promotion = nil
        }
        self.from = from
        self.to = to
    }
}

// MARK: - Position

/// Castling availability, as the four letters of a FEN's third field.
struct CastlingRights: OptionSet, Hashable {
    let rawValue: Int

    static let whiteKingside = CastlingRights(rawValue: 1 << 0)
    static let whiteQueenside = CastlingRights(rawValue: 1 << 1)
    static let blackKingside = CastlingRights(rawValue: 1 << 2)
    static let blackQueenside = CastlingRights(rawValue: 1 << 3)

    /// The FEN field, `KQkq` or `-`, in the order every FEN writes it.
    var fenField: String {
        var text = ""
        if contains(.whiteKingside) { text += "K" }
        if contains(.whiteQueenside) { text += "Q" }
        if contains(.blackKingside) { text += "k" }
        if contains(.blackQueenside) { text += "q" }
        return text.isEmpty ? "-" : text
    }

    /// Parses the field. `-` and an empty field both mean nobody may castle; unknown
    /// letters are ignored rather than failing, because a Chess960 FEN writes files here
    /// and losing the rights is better than refusing to show the game.
    init(fenField: String) {
        var rights: CastlingRights = []
        if fenField.contains("K") { rights.insert(.whiteKingside) }
        if fenField.contains("Q") { rights.insert(.whiteQueenside) }
        if fenField.contains("k") { rights.insert(.blackKingside) }
        if fenField.contains("q") { rights.insert(.blackQueenside) }
        self = rights
    }

    init(rawValue: Int) { self.rawValue = rawValue }
}

/// The full state a FEN describes, and the only mutable thing in the replay.
///
/// It is a `struct` with value semantics on purpose: `snapshots` mutates one copy in a
/// loop and freezes an immutable `Snapshot` out of it at each step, so no snapshot can be
/// changed by a later move.
struct Position {
    var pieces: [BoardSquare: ChessPiece]
    var sideToMove: PieceColor
    var castling: CastlingRights
    /// The square *behind* a pawn that has just moved two, i.e. the square a capturing
    /// pawn would land on. Written unconditionally after every double push, which is what
    /// standard FEN does and what makes `1. e4` read `… e3 0 1` as everyone writes it.
    var enPassant: BoardSquare?
    var halfmoveClock: Int
    var fullmoveNumber: Int

    // MARK: Parsing

    /// Parses a FEN. Nil on anything that is not eight ranks of exactly eight squares with
    /// a side to move; the clock fields are optional and default to `0 1`, because
    /// truncated four-field FENs are common in the wild and the clocks are the least
    /// load-bearing thing here.
    init?(fen: String) {
        let fields = fen.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        guard fields.count >= 2 else { return nil }

        var pieces: [BoardSquare: ChessPiece] = [:]
        let ranks = fields[0].split(separator: "/", omittingEmptySubsequences: false)
        guard ranks.count == 8 else { return nil }

        // FEN writes rank 8 first, so the first row read is board rank 7.
        for (rowIndex, row) in ranks.enumerated() {
            let rank = 7 - rowIndex
            var file = 0
            for character in row {
                if let empty = character.wholeNumberValue, (1...8).contains(empty) {
                    file += empty
                } else if let piece = ChessPiece(fenCharacter: character) {
                    guard let square = BoardSquare(file: file, rank: rank) else { return nil }
                    pieces[square] = piece
                    file += 1
                } else {
                    return nil
                }
            }
            guard file == 8 else { return nil }
        }

        guard let sideToMove = PieceColor(fenSide: fields[1]) else { return nil }

        self.pieces = pieces
        self.sideToMove = sideToMove
        self.castling = CastlingRights(fenField: fields.count > 2 ? fields[2] : "-")
        self.enPassant = fields.count > 3 ? BoardSquare(algebraic: fields[3]) : nil
        self.halfmoveClock = fields.count > 4 ? (Int(fields[4]) ?? 0) : 0
        self.fullmoveNumber = fields.count > 5 ? (Int(fields[5]) ?? 1) : 1
    }

    // MARK: Serialising

    /// The six-field FEN for this position, byte-identical to what Lichess or Stockfish
    /// would write for it — the string is sent to the server for position analysis, so
    /// "close enough" is not.
    var fen: String {
        var placement: [String] = []
        for rank in stride(from: 7, through: 0, by: -1) {
            var row = ""
            var empty = 0
            for file in 0...7 {
                let piece = BoardSquare(file: file, rank: rank).flatMap { pieces[$0] }
                if let piece {
                    if empty > 0 {
                        row += String(empty)
                        empty = 0
                    }
                    row.append(piece.fenCharacter)
                } else {
                    empty += 1
                }
            }
            if empty > 0 { row += String(empty) }
            placement.append(row)
        }

        return [
            placement.joined(separator: "/"),
            sideToMove.letter,
            castling.fenField,
            enPassant?.algebraic ?? "-",
            String(halfmoveClock),
            String(fullmoveNumber),
        ].joined(separator: " ")
    }

    /// Freezes the current state into an immutable snapshot.
    func snapshot(ply: Int, lastMove: LastMove?) -> Snapshot {
        Snapshot(ply: ply, pieces: pieces, lastMove: lastMove, sideToMove: sideToMove, fen: fen)
    }

    // MARK: Applying

    /// Applies one move, returning false and leaving the position untouched if it does not
    /// fit. False is how the replay learns to stop.
    ///
    /// This is an *applier*, not a chess engine: it never asks whether a move is legal,
    /// only whether it is coherent — a piece of the side to move stands on the from-square,
    /// it is not capturing its own, and a castle has its rook. Every move it is given has
    /// already been validated by the server that stored the game, so generating moves to
    /// re-check them would cost eight plies of work per position to re-derive a fact we
    /// were handed. What the coherence checks buy is the thing that actually goes wrong: a
    /// move list that has desynced from the position stops the replay instead of quietly
    /// drawing a corrupt board for the rest of the game.
    ///
    /// This is also why the app does not run ChessKit here. ChessKit 0.17.0 applies moves
    /// correctly but its FEN is wrong in three ways we would ship: the en-passant target
    /// survives the capture that consumes it (`exd6` leaves `… d6` in the FEN), the
    /// halfmove clock is not reset by an en-passant capture, and capturing a rook on its
    /// home square does not clear the opponent's castling right. All three corrupt a FEN
    /// we send to an engine. Doing it here is a hundred lines and is exact.
    mutating func apply(_ move: UCIMove) -> Bool {
        guard let piece = pieces[move.from], piece.color == sideToMove else { return false }
        if let occupant = pieces[move.to], occupant.color == piece.color { return false }

        var isCapture = pieces[move.to] != nil
        var isPawnMove = piece.kind == .pawn
        var next = pieces

        // En passant: the captured pawn is beside the destination, not on it.
        if piece.kind == .pawn, move.to == enPassant, pieces[move.to] == nil {
            guard let captured = BoardSquare(file: move.to.file, rank: move.from.rank),
                pieces[captured]?.kind == .pawn
            else { return false }
            next[captured] = nil
            isCapture = true
        }

        // Castling: the UCI is only the king's two-square step, so the rook has to be
        // moved here or the board loses a rook for the rest of the game.
        if piece.kind == .king, abs(move.to.file - move.from.file) == 2,
            move.to.rank == move.from.rank
        {
            let kingside = move.to.file > move.from.file
            guard let rookFrom = BoardSquare(file: kingside ? 7 : 0, rank: move.from.rank),
                let rookTo = BoardSquare(file: kingside ? 5 : 3, rank: move.from.rank),
                let rook = pieces[rookFrom], rook.kind == .rook, rook.color == piece.color
            else { return false }
            next[rookFrom] = nil
            next[rookTo] = rook
        }

        // Promotion. A pawn arriving on the far rank without a promotion letter is
        // malformed data, but a pawn is not a legal occupant of the last rank either, so
        // it promotes to a queen — the overwhelmingly likely intent — rather than leaving
        // an impossible board behind.
        let lastRank = piece.color == .white ? 7 : 0
        let promotes = piece.kind == .pawn && move.to.rank == lastRank
        if move.promotion != nil && !promotes { return false }
        let moved = promotes ? ChessPiece(move.promotion ?? .queen, piece.color) : piece

        next[move.from] = nil
        next[move.to] = moved
        isPawnMove = isPawnMove || promotes

        // Castling rights. A right dies when the king moves, when the rook leaves its
        // corner, and — the one everyone forgets — when the rook is captured in it.
        var rights = castling
        if piece.kind == .king {
            rights.subtract(piece.color == .white ? [.whiteKingside, .whiteQueenside] : [.blackKingside, .blackQueenside])
        }
        for square in [move.from, move.to] {
            switch (square.file, square.rank) {
            case (0, 0): rights.subtract(.whiteQueenside)
            case (7, 0): rights.subtract(.whiteKingside)
            case (0, 7): rights.subtract(.blackQueenside)
            case (7, 7): rights.subtract(.blackKingside)
            default: break
            }
        }

        // The en-passant target lives exactly one ply.
        var target: BoardSquare?
        if piece.kind == .pawn, abs(move.to.rank - move.from.rank) == 2 {
            target = BoardSquare(file: move.from.file, rank: (move.from.rank + move.to.rank) / 2)
        }

        pieces = next
        castling = rights
        enPassant = target
        halfmoveClock = (isCapture || isPawnMove) ? 0 : halfmoveClock + 1
        if sideToMove == .black { fullmoveNumber += 1 }
        sideToMove = sideToMove.opposite
        return true
    }
}

extension PieceColor {
    /// Parses a FEN's side-to-move field.
    init?(fenSide: String) {
        switch fenSide.lowercased() {
        case "w": self = .white
        case "b": self = .black
        default: return nil
        }
    }
}
