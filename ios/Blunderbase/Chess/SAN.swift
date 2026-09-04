import Foundation

/// Standard algebraic notation, generated on the phone.
///
/// Stored moves arrive with SAN attached, so the moves list never needs this. Engine lines
/// are the exception: `pv` is always there and `san` is only sometimes — a run that was
/// stored without it, a Maia guess, anything a live pass hands over — and a pane that falls
/// back to `g1f3 b8c6 f1c4` reads as machine output rather than as chess. This file closes
/// that gap so the fallback is a real line, not a worse one.
///
/// **The expensive part is disambiguation, and it is not optional.** `Nd2` is wrong when
/// the other knight also reaches d2; the reader has to be told which one, and answering
/// that means generating the moves of every same-kind piece and asking which of them are
/// *legal*. Legal, not merely reachable: a knight pinned to its king is not an alternative,
/// so writing `Nbd2` because a pinned knight on b1 "could" go there is a notation bug that
/// looks exactly like a real move. That single requirement is why there is move generation
/// in here at all.
///
/// **Totality is the contract**, as it is in `Replay`. Nothing here throws or traps. A
/// malformed UCI, a FEN that does not parse, a variation that desyncs from the position —
/// each stops the rendering and hands back what was built. A line that goes bad after three
/// plies shows three plies, which is the right failure for a reader.
///
/// The position type, the FEN parser and the move applier are `Replay`'s, reused rather
/// than reimplemented: two FEN parsers in one app is two answers to "where may this king
/// castle", and the board would eventually disagree with the notation under it.
///
/// Chess960 is out of scope. Castling is recognised by the king's two-square step to the
/// standard squares, which is what the backend's engines emit.
public enum SAN {

    /// One UCI move rendered as SAN in the position `fen` describes.
    ///
    /// - Returns: nil when the FEN does not parse, the UCI is not a move, or the move is not
    ///   a legal move for the side to move in that position. Callers that render a whole
    ///   variation want `line(_:from:limit:)`, which turns that nil into a truncation.
    public static func san(forUCI uci: String, fen: String) -> String? {
        guard let position = Position(fen: fen) else { return nil }
        return render(uci, in: position)?.text
    }

    /// A principal variation as a reader would write it: the move number before White's
    /// move, an ellipsis form when the line starts on Black's turn, bare SAN after that.
    ///
    /// The numbers come from the FEN's fullmove field rather than from a ply the caller
    /// passes in, because the FEN is the thing that actually knows where the line starts —
    /// a caller counting plies has to get the same answer twice, and the second one drifts.
    ///
    /// - Parameter limit: how many plies to render. Zero or negative renders nothing.
    /// - Returns: the rendered prefix, empty only when nothing could be rendered at all.
    public static func line(_ pv: [String], from fen: String, limit: Int = 8) -> String {
        guard limit > 0, var position = Position(fen: fen) else { return "" }

        var parts: [String] = []
        parts.reserveCapacity(min(limit, pv.count))

        for uci in pv.prefix(limit) {
            let number = position.fullmoveNumber
            let isWhite = position.sideToMove == .white
            guard let move = render(uci, in: position) else { break }

            if isWhite {
                parts.append("\(number). \(move.text)")
            } else if parts.isEmpty {
                parts.append("\(number)… \(move.text)")
            } else {
                parts.append(move.text)
            }
            position = move.next
        }

        return parts.joined(separator: " ")
    }

    // MARK: - Rendering

    /// Renders one move and hands back the position after it, so a variation is one pass
    /// down the list rather than a FEN round-trip per ply.
    // MARK: Playing on the board

    /// Where the piece on `square` may legally go.
    ///
    /// This is the same generator the notation uses, exposed because the two questions are
    /// really one: a board that accepts a move the notation would refuse to write is a board
    /// that can reach a position the rest of the app cannot describe. Sharing it means the
    /// squares a finger may tap and the moves that can be spelled are the same set by
    /// construction.
    ///
    /// Empty when the square is empty, holds the other side's piece, or the FEN does not
    /// parse — the board simply offers nothing rather than guessing.
    public static func legalDestinations(from square: BoardSquare, fen: String) -> [BoardSquare] {
        guard let position = Position(fen: fen) else { return [] }
        guard let piece = position.pieces[square], piece.color == position.sideToMove else { return [] }
        var seen: Set<BoardSquare> = []
        for move in legalMoves(in: position) where move.from == square {
            seen.insert(move.to)
        }
        return seen.sorted()
    }

    /// Whether moving between these squares is a pawn reaching the last rank, and so needs
    /// a piece chosen before it can be played.
    ///
    /// Asked before the move is made, because the answer decides whether the board plays it
    /// straight away or stops to ask. It says nothing about legality; `legalDestinations`
    /// has already been consulted by the time this matters.
    public static func isPromotion(from: BoardSquare, to: BoardSquare, fen: String) -> Bool {
        guard let position = Position(fen: fen) else { return false }
        guard let piece = position.pieces[from], piece.kind == .pawn else { return false }
        return to.rank == (piece.color == .white ? 7 : 0)
    }

    /// Whether the side to move has any legal reply at all.
    ///
    /// A false here means the game is over on this board — mate or stalemate — which is the
    /// one position an analysis board must not be opened on, because there is nothing to
    /// search and engines disagree about how to say so.
    public static func hasLegalMove(fen: String) -> Bool {
        guard let position = Position(fen: fen) else { return false }
        return !legalMoves(in: position).isEmpty
    }

    private static func render(_ uci: String, in position: Position) -> (text: String, next: Position)? {
        guard let parsed = UCIMove(uci) else { return nil }

        // The move has to be one the position actually offers. Matching against generated
        // moves rather than trusting the string is what makes an illegal or desynced UCI a
        // nil instead of a plausible-looking piece of notation.
        let legal = legalMoves(in: position)
        let wanted = parsed.promotion
        guard
            let move = legal.first(where: {
                $0.from == parsed.from && $0.to == parsed.to
                    && ($0.promotion == wanted || (wanted == nil && $0.promotion == .queen))
            }),
            let piece = position.pieces[move.from],
            let applied = UCIMove(move.uci)
        else { return nil }

        var next = position
        guard next.apply(applied) else { return nil }

        let body: String
        if piece.kind == .king, abs(move.to.file - move.from.file) == 2 {
            body = move.to.file > move.from.file ? "O-O" : "O-O-O"
        } else {
            let isEnPassant =
                piece.kind == .pawn && position.pieces[move.to] == nil && move.to == position.enPassant
            let isCapture = position.pieces[move.to] != nil || isEnPassant

            var text = piece.kind == .pawn ? "" : piece.kind.letter.uppercased()
            if piece.kind == .pawn {
                // A pawn names its file only when it captures — `exd5`, never `ee4`. It is
                // also the whole of a pawn's disambiguation: two pawns of one colour can
                // never capture onto the same square from the same file.
                if isCapture { text += String(move.from.algebraic.prefix(1)) }
            } else {
                text += disambiguation(for: move, piece: piece, among: legal, in: position)
            }
            if isCapture { text += "x" }
            text += move.to.algebraic
            if let promotion = move.promotion { text += "=" + promotion.letter.uppercased() }
            body = text
        }

        return (body + suffix(after: next), next)
    }

    /// `+`, `#`, or nothing. Mate is check plus no reply, which is why this needs a second
    /// round of move generation rather than a flag out of the first.
    private static func suffix(after position: Position) -> String {
        guard isInCheck(position) else { return "" }
        return legalMoves(in: position).isEmpty ? "#" : "+"
    }

    /// The file, rank or whole square that tells this piece apart from the others of its
    /// kind that could legally land on the same square.
    ///
    /// File first, rank only when the file does not settle it, both when neither does — the
    /// order every notation standard uses, so `Nbd2`, `R1a3` and `Qh4e1` come out in the
    /// forms a reader expects. Pawns and kings never take one: a pawn's file prefix is
    /// handled with its capture, and a side has one king.
    private static func disambiguation(
        for move: Move,
        piece: ChessPiece,
        among legal: [Move],
        in position: Position
    ) -> String {
        guard piece.kind != .pawn, piece.kind != .king else { return "" }

        let rivals = legal.filter {
            $0.to == move.to && $0.from != move.from && position.pieces[$0.from] == piece
        }
        guard !rivals.isEmpty else { return "" }

        if !rivals.contains(where: { $0.from.file == move.from.file }) {
            return String(move.from.algebraic.prefix(1))
        }
        if !rivals.contains(where: { $0.from.rank == move.from.rank }) {
            return String(move.from.algebraic.suffix(1))
        }
        return move.from.algebraic
    }
}

// MARK: - Moves

/// A generated move: the two squares and, for a pawn reaching the far rank, what it becomes.
///
/// `UCIMove` is the same shape but can only be built by parsing a string, and the generator
/// makes tens of thousands of these — so this exists to keep generation off the string path.
/// It converts back at the one place a move is actually applied.
private struct Move: Hashable {
    let from: BoardSquare
    let to: BoardSquare
    let promotion: PieceKind?

    init(_ from: BoardSquare, _ to: BoardSquare, _ promotion: PieceKind? = nil) {
        self.from = from
        self.to = to
        self.promotion = promotion
    }

    /// The long-algebraic string, for handing the move to `Position.apply`.
    var uci: String {
        from.algebraic + to.algebraic + (promotion.map { String($0.letter) } ?? "")
    }
}

// MARK: - Move generation

extension SAN {

    private static let knightSteps = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
    private static let diagonals = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    private static let orthogonals = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    private static let kingSteps = diagonals + orthogonals
    /// What a pawn may become. Order is irrelevant — every one of them is generated, and
    /// the caller matches on the promotion letter it was given.
    private static let promotionKinds: [PieceKind] = [.queen, .rook, .bishop, .knight]

    /// Every legal move for the side to move.
    ///
    /// Legality is decided the honest way — make the move on a copy of the piece map and ask
    /// whether the mover's king is attacked — rather than by working out pin rays. It is
    /// more work per move and it is right in the cases that catch pin logic out: the pinned
    /// piece that may still move *along* the pin, and the en-passant capture that removes
    /// two pawns from one rank at once. This runs on a handful of positions per second, so
    /// the trade is free.
    private static func legalMoves(in position: Position) -> [Move] {
        pseudoLegalMoves(in: position).filter { move in
            let after = pieces(after: move, in: position)
            guard let king = kingSquare(of: position.sideToMove, in: after) else { return true }
            return !isAttacked(king, by: position.sideToMove.opposite, in: after)
        }
    }

    /// True when the side to move stands in check.
    private static func isInCheck(_ position: Position) -> Bool {
        guard let king = kingSquare(of: position.sideToMove, in: position.pieces) else { return false }
        return isAttacked(king, by: position.sideToMove.opposite, in: position.pieces)
    }

    /// Moves that respect how a piece steps, without asking about the king.
    private static func pseudoLegalMoves(in position: Position) -> [Move] {
        var moves: [Move] = []
        moves.reserveCapacity(48)

        for (square, piece) in position.pieces where piece.color == position.sideToMove {
            switch piece.kind {
            case .pawn: pawnMoves(from: square, piece: piece, in: position, into: &moves)
            case .knight: stepMoves(from: square, piece: piece, steps: knightSteps, in: position, into: &moves)
            case .king:
                stepMoves(from: square, piece: piece, steps: kingSteps, in: position, into: &moves)
                castles(from: square, piece: piece, in: position, into: &moves)
            case .bishop: slideMoves(from: square, piece: piece, directions: diagonals, in: position, into: &moves)
            case .rook: slideMoves(from: square, piece: piece, directions: orthogonals, in: position, into: &moves)
            case .queen: slideMoves(from: square, piece: piece, directions: kingSteps, in: position, into: &moves)
            }
        }

        return moves
    }

    private static func pawnMoves(
        from square: BoardSquare,
        piece: ChessPiece,
        in position: Position,
        into moves: inout [Move]
    ) {
        let direction = piece.color == .white ? 1 : -1
        let homeRank = piece.color == .white ? 1 : 6
        let lastRank = piece.color == .white ? 7 : 0

        func land(_ target: BoardSquare) {
            if target.rank == lastRank {
                for kind in promotionKinds { moves.append(Move(square, target, kind)) }
            } else {
                moves.append(Move(square, target))
            }
        }

        if let single = square.offset(files: 0, ranks: direction), position.pieces[single] == nil {
            land(single)
            if square.rank == homeRank,
                let double = square.offset(files: 0, ranks: 2 * direction),
                position.pieces[double] == nil
            {
                moves.append(Move(square, double))
            }
        }

        for sideways in [-1, 1] {
            guard let target = square.offset(files: sideways, ranks: direction) else { continue }
            if let occupant = position.pieces[target] {
                if occupant.color != piece.color { land(target) }
            } else if target == position.enPassant,
                let captured = BoardSquare(file: target.file, rank: square.rank),
                position.pieces[captured] == ChessPiece(.pawn, piece.color.opposite)
            {
                // The en-passant target is only a move if the pawn it names is still there.
                // A FEN can carry a stale target; generating a move the applier would then
                // refuse would turn a fine variation into a truncated one.
                moves.append(Move(square, target))
            }
        }
    }

    private static func stepMoves(
        from square: BoardSquare,
        piece: ChessPiece,
        steps: [(Int, Int)],
        in position: Position,
        into moves: inout [Move]
    ) {
        for (files, ranks) in steps {
            guard let target = square.offset(files: files, ranks: ranks) else { continue }
            if position.pieces[target]?.color == piece.color { continue }
            moves.append(Move(square, target))
        }
    }

    private static func slideMoves(
        from square: BoardSquare,
        piece: ChessPiece,
        directions: [(Int, Int)],
        in position: Position,
        into moves: inout [Move]
    ) {
        for (files, ranks) in directions {
            var target = square.offset(files: files, ranks: ranks)
            while let current = target {
                if let occupant = position.pieces[current] {
                    if occupant.color != piece.color { moves.append(Move(square, current)) }
                    break
                }
                moves.append(Move(square, current))
                target = current.offset(files: files, ranks: ranks)
            }
        }
    }

    /// Castling, which is the only move whose legality is not "does the king survive it".
    ///
    /// The king may not start in check, pass through an attacked square, or land on one, and
    /// every square it crosses must be empty. The rights in the FEN are necessary but never
    /// sufficient: a FEN can name a right whose king or rook has been replaced, and a castle
    /// generated on that would render `O-O` for a move nothing on the board can play.
    private static func castles(
        from square: BoardSquare,
        piece: ChessPiece,
        in position: Position,
        into moves: inout [Move]
    ) {
        let rank = piece.color == .white ? 0 : 7
        guard square.file == 4, square.rank == rank else { return }
        guard !isAttacked(square, by: piece.color.opposite, in: position.pieces) else { return }

        let options: [(right: CastlingRights, rook: Int, empty: [Int], crossed: [Int], king: Int)] = [
            (piece.color == .white ? .whiteKingside : .blackKingside, 7, [5, 6], [5, 6], 6),
            (piece.color == .white ? .whiteQueenside : .blackQueenside, 0, [1, 2, 3], [2, 3], 2),
        ]

        for option in options {
            guard position.castling.contains(option.right) else { continue }
            guard let rookSquare = BoardSquare(file: option.rook, rank: rank),
                position.pieces[rookSquare] == ChessPiece(.rook, piece.color)
            else { continue }
            guard option.empty.allSatisfy({ file in
                BoardSquare(file: file, rank: rank).map { position.pieces[$0] == nil } ?? false
            }) else { continue }
            guard option.crossed.allSatisfy({ file in
                guard let crossed = BoardSquare(file: file, rank: rank) else { return false }
                return !isAttacked(crossed, by: piece.color.opposite, in: position.pieces)
            }) else { continue }
            guard let destination = BoardSquare(file: option.king, rank: rank) else { continue }
            moves.append(Move(square, destination))
        }
    }

    // MARK: Board queries

    /// The piece map after a move, with no clocks, rights or side-to-move bookkeeping.
    ///
    /// This is deliberately *not* `Position.apply`: the only question asked of the result is
    /// whether a king stands attacked, and building a full position — plus its castling
    /// rights and en-passant target — for every one of forty candidate moves is work whose
    /// answer is thrown away.
    private static func pieces(after move: Move, in position: Position) -> [BoardSquare: ChessPiece] {
        var pieces = position.pieces
        guard let piece = pieces[move.from] else { return pieces }

        if piece.kind == .pawn, move.to == position.enPassant, pieces[move.to] == nil,
            let captured = BoardSquare(file: move.to.file, rank: move.from.rank)
        {
            pieces[captured] = nil
        }

        if piece.kind == .king, abs(move.to.file - move.from.file) == 2 {
            let kingside = move.to.file > move.from.file
            if let rookFrom = BoardSquare(file: kingside ? 7 : 0, rank: move.from.rank),
                let rookTo = BoardSquare(file: kingside ? 5 : 3, rank: move.from.rank),
                let rook = pieces[rookFrom]
            {
                pieces[rookFrom] = nil
                pieces[rookTo] = rook
            }
        }

        pieces[move.from] = nil
        pieces[move.to] = move.promotion.map { ChessPiece($0, piece.color) } ?? piece
        return pieces
    }

    /// Where a colour's king stands. The lowest square wins if a corrupt FEN somehow has
    /// two, so that the same board always renders the same notation.
    private static func kingSquare(
        of color: PieceColor,
        in pieces: [BoardSquare: ChessPiece]
    ) -> BoardSquare? {
        let king = ChessPiece(.king, color)
        var found: BoardSquare?
        for (square, piece) in pieces where piece == king {
            if let current = found, current < square { continue }
            found = square
        }
        return found
    }

    /// Whether `color` attacks `square`, asked from the square outwards.
    ///
    /// Walking out from the square is what keeps this cheap enough to call once per
    /// candidate move: it is a fixed handful of rays and jumps rather than a pass over every
    /// enemy piece's move list. Note that it answers *attacks*, not *may move to* — a pawn's
    /// push is not an attack, and a square defended by a pinned piece is still defended,
    /// which is exactly what castling and king moves need to know.
    private static func isAttacked(
        _ square: BoardSquare,
        by color: PieceColor,
        in pieces: [BoardSquare: ChessPiece]
    ) -> Bool {
        // A pawn of `color` attacking this square stands one rank in front of it, from that
        // colour's point of view — so look backwards along its direction of travel.
        let behind = color == .white ? -1 : 1
        for sideways in [-1, 1] {
            if let origin = square.offset(files: sideways, ranks: behind),
                pieces[origin] == ChessPiece(.pawn, color)
            { return true }
        }

        for (files, ranks) in knightSteps {
            if let origin = square.offset(files: files, ranks: ranks),
                pieces[origin] == ChessPiece(.knight, color)
            { return true }
        }

        for (files, ranks) in kingSteps {
            if let origin = square.offset(files: files, ranks: ranks),
                pieces[origin] == ChessPiece(.king, color)
            { return true }
        }

        for (directions, kind) in [(diagonals, PieceKind.bishop), (orthogonals, PieceKind.rook)] {
            for (files, ranks) in directions {
                var step = square.offset(files: files, ranks: ranks)
                while let current = step {
                    if let occupant = pieces[current] {
                        if occupant.color == color, occupant.kind == kind || occupant.kind == .queen {
                            return true
                        }
                        break
                    }
                    step = current.offset(files: files, ranks: ranks)
                }
            }
        }

        return false
    }
}
