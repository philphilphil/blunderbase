import CoreGraphics

/// The app's own chess vocabulary, and the one place that turns a square into a point.
///
/// Nothing here imports a chess library. That is deliberate: the board, the arrows, the
/// glyph and the eval bar all speak these four types, so the view layer can be read,
/// previewed and re-implemented without knowing what replays the moves. `Replay` is the
/// only file allowed to know that, and it hands back these types.
///
/// Files and ranks are 0-based *board* coordinates, not view coordinates: file 0 is the
/// a-file, rank 0 is White's first rank. Which way up that ends on screen is
/// `BoardGeometry`'s business and nothing else's.

// MARK: - Pieces

/// Which army a piece belongs to. Also used for board orientation, where it means "the
/// side sitting at the bottom" — the same word the web app uses for the same prop.
public enum PieceColor: String, Sendable, Hashable, CaseIterable {
    case white
    case black

    public var opposite: PieceColor { self == .white ? .black : .white }

    /// `w` / `b`, the letter in a FEN's side-to-move field and in an asset name.
    public var letter: String { self == .white ? "w" : "b" }
}

/// The six kinds, named rather than lettered so call sites read as chess.
public enum PieceKind: String, Sendable, Hashable, CaseIterable {
    case pawn
    case knight
    case bishop
    case rook
    case queen
    case king

    /// The FEN letter, always lowercase; the colour supplies the case.
    public var letter: Character {
        switch self {
        case .pawn: "p"
        case .knight: "n"
        case .bishop: "b"
        case .rook: "r"
        case .queen: "q"
        case .king: "k"
        }
    }

    /// Parses a FEN/UCI promotion letter in either case. Returns nil for anything else,
    /// which is how a malformed UCI stops a replay instead of guessing a piece.
    public init?(letter: Character) {
        switch Character(letter.lowercased()) {
        case "p": self = .pawn
        case "n": self = .knight
        case "b": self = .bishop
        case "r": self = .rook
        case "q": self = .queen
        case "k": self = .king
        default: return nil
        }
    }
}

/// A piece as the board draws it: what it is and whose it is, with no square attached.
///
/// The square is the dictionary key in a `Snapshot`, not a field here, because a piece
/// that carried its own square would let the two disagree.
public struct ChessPiece: Sendable, Hashable {
    public let kind: PieceKind
    public let color: PieceColor

    public init(_ kind: PieceKind, _ color: PieceColor) {
        self.kind = kind
        self.color = color
    }

    /// The FEN character: uppercase for White, lowercase for Black.
    public var fenCharacter: Character {
        color == .white ? Character(kind.letter.uppercased()) : kind.letter
    }

    /// Parses a FEN placement character. Nil for anything that is not a piece letter.
    public init?(fenCharacter: Character) {
        guard let kind = PieceKind(letter: fenCharacter) else { return nil }
        self.init(kind, fenCharacter.isUppercase ? .white : .black)
    }
}

// MARK: - Squares

/// One of the 64 squares, as a file/rank pair rather than an index.
///
/// A pair is the shape the rest of the app actually wants: the geometry mirrors a
/// coordinate for orientation, the arrow layer needs the file delta to tell a knight move
/// from a bishop move, and the replay walks ranks to serialise a FEN. An index would have
/// every one of those sites doing `/ 8` and `% 8`.
public struct BoardSquare: Sendable, Hashable, Comparable {
    /// 0 = a-file … 7 = h-file.
    public let file: Int
    /// 0 = White's first rank … 7 = Black's.
    public let rank: Int

    /// Fails outside 0…7 on either axis, so an out-of-range square cannot exist and no
    /// consumer has to check one.
    public init?(file: Int, rank: Int) {
        guard (0...7).contains(file), (0...7).contains(rank) else { return nil }
        self.file = file
        self.rank = rank
    }

    /// Parses `"e4"`. Rejects anything that is not exactly one file letter followed by one
    /// rank digit — `""`, `"e"`, `"e0"`, `"j9"`, `"E4 "`. The strictness is the point: this
    /// is the gate a corrupt UCI string hits before it can move a piece.
    public init?(algebraic: String) {
        guard algebraic.count == 2 else { return nil }
        let chars = Array(algebraic)
        guard let fileScalar = chars[0].asciiValue, let rankScalar = chars[1].asciiValue else {
            return nil
        }
        let file = Int(fileScalar) - Int(Character("a").asciiValue ?? 97)
        let rank = Int(rankScalar) - Int(Character("1").asciiValue ?? 49)
        self.init(file: file, rank: rank)
    }

    /// `"e4"`. Round-trips with `init(algebraic:)` for all 64 squares.
    public var algebraic: String {
        let fileLetter = Character(UnicodeScalar(UInt8(97 + file)))
        return "\(fileLetter)\(rank + 1)"
    }

    /// Where a relative step lands, or nil if it leaves the board. Used by the replay for
    /// the pawn behind an en-passant target and by the arrow layer for its L-shaped shaft.
    public func offset(files: Int, ranks: Int) -> BoardSquare? {
        BoardSquare(file: file + files, rank: rank + ranks)
    }

    /// True where a light square sits. a1 is dark, so the parity is `(file + rank)` odd.
    public var isLight: Bool { (file + rank) % 2 == 1 }

    /// Rank-major order, a1 first — a stable order for anything that has to iterate.
    public static func < (lhs: BoardSquare, rhs: BoardSquare) -> Bool {
        (lhs.rank, lhs.file) < (rhs.rank, rhs.file)
    }

    /// All 64, in rank-major order.
    public static let all: [BoardSquare] = (0...7).flatMap { rank in
        (0...7).compactMap { file in BoardSquare(file: file, rank: rank) }
    }

    /// Unchecked construction, for the corners below only. It exists so that a call site
    /// with a known-good square — a preview, a default — does not have to force-unwrap.
    private init(unchecked file: Int, rank: Int) {
        self.file = file
        self.rank = rank
    }

    public static let a1 = BoardSquare(unchecked: 0, rank: 0)
    public static let h1 = BoardSquare(unchecked: 7, rank: 0)
    public static let a8 = BoardSquare(unchecked: 0, rank: 7)
    public static let h8 = BoardSquare(unchecked: 7, rank: 7)
}

// MARK: - Geometry

/// The square-to-point map every board layer shares.
///
/// `BoardView` measures itself once and hands the same geometry to the pieces, the arrows
/// and the glyph. That is why this is a value passed down rather than each layer doing its
/// own division: three layers that each derive a square size from a slightly different
/// rectangle drift by a pixel, and an arrow head that misses the piece it points at is the
/// most obvious bug on the screen.
///
/// Orientation is applied here and nowhere else. Every other file works in board
/// coordinates and stays right way up.
public struct BoardGeometry: Sendable, Hashable {
    /// Side of one square in points.
    public let squareSize: CGFloat
    /// The side sitting at the bottom of the screen.
    public let orientation: PieceColor
    /// Top-left of the board within the coordinate space the layers draw in.
    public let origin: CGPoint

    public init(squareSize: CGFloat, orientation: PieceColor = .white, origin: CGPoint = .zero) {
        self.squareSize = squareSize
        self.orientation = orientation
        self.origin = origin
    }

    /// Builds the geometry for a rectangle, taking the largest centred square that fits.
    /// A board that is not square is worse than a board with a margin.
    public init(fitting size: CGSize, orientation: PieceColor = .white) {
        let side = max(0, min(size.width, size.height))
        self.init(
            squareSize: side / 8,
            orientation: orientation,
            origin: CGPoint(x: (size.width - side) / 2, y: (size.height - side) / 2)
        )
    }

    /// The board's own side length.
    public var boardSize: CGFloat { squareSize * 8 }

    /// Column 0…7 from the left of the screen for a square, after orientation.
    public func column(of square: BoardSquare) -> Int {
        orientation == .white ? square.file : 7 - square.file
    }

    /// Row 0…7 from the top of the screen for a square, after orientation.
    public func row(of square: BoardSquare) -> Int {
        orientation == .white ? 7 - square.rank : square.rank
    }

    /// The square's top-left corner in view coordinates.
    public func frame(of square: BoardSquare) -> CGRect {
        CGRect(
            x: origin.x + CGFloat(column(of: square)) * squareSize,
            y: origin.y + CGFloat(row(of: square)) * squareSize,
            width: squareSize,
            height: squareSize
        )
    }

    /// The square's centre — where a piece is positioned and where an arrow starts or ends.
    public func center(of square: BoardSquare) -> CGPoint {
        let frame = frame(of: square)
        return CGPoint(x: frame.midX, y: frame.midY)
    }

    /// Which square a point falls in, or nil outside the board. Backs `onSquareTap`.
    public func square(at point: CGPoint) -> BoardSquare? {
        guard squareSize > 0 else { return nil }
        let column = Int(((point.x - origin.x) / squareSize).rounded(.down))
        let row = Int(((point.y - origin.y) / squareSize).rounded(.down))
        guard (0...7).contains(column), (0...7).contains(row) else { return nil }
        let file = orientation == .white ? column : 7 - column
        let rank = orientation == .white ? 7 - row : row
        return BoardSquare(file: file, rank: rank)
    }
}
