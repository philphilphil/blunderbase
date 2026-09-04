import SwiftUI

/// The board.
///
/// Everything on this screen is drawn from one `BoardGeometry`, measured once by the
/// `GeometryReader` at the top: squares, coordinates, highlights, pieces, arrows and the
/// glyph all take the same square size and origin. Three layers that each divide their own
/// rectangle by eight drift apart by a fraction of a point, and an arrow head that misses
/// the piece it points at is the most obvious bug a chess app can have.
///
/// The board is read-only. Blunderbase is an analysis board: the user steps through a
/// finished game and reads what the engine and Maia say about it. `onSquareTap` exists for
/// the day something wants to select a square, and is unwired otherwise.
struct BoardView: View {
    let snapshot: Snapshot
    /// Which side is at the bottom.
    var orientation: PieceColor = .white
    var arrows: [BoardArrow] = []
    /// A classification badge on one square.
    var glyph: BoardGlyph? = nil
    /// Extra squares to tint, for anything that is not the last move.
    var highlightSquares: Set<BoardSquare> = []
    /// The piece waiting for a destination, tinted like a held piece.
    var selectedSquare: BoardSquare? = nil
    /// Where that piece may go, drawn as dots.
    var destinations: Set<BoardSquare> = []
    var showCoordinates: Bool = true
    var onSquareTap: ((BoardSquare) -> Void)? = nil

    /// Where each piece is *and which piece it is* across snapshots, so a piece slides
    /// rather than fading. See `PieceLayout`.
    @State private var layout: PieceLayout

    init(
        snapshot: Snapshot,
        orientation: PieceColor = .white,
        arrows: [BoardArrow] = [],
        glyph: BoardGlyph? = nil,
        highlightSquares: Set<BoardSquare> = [],
        selectedSquare: BoardSquare? = nil,
        destinations: Set<BoardSquare> = [],
        showCoordinates: Bool = true,
        onSquareTap: ((BoardSquare) -> Void)? = nil
    ) {
        self.snapshot = snapshot
        self.orientation = orientation
        self.arrows = arrows
        self.glyph = glyph
        self.highlightSquares = highlightSquares
        self.selectedSquare = selectedSquare
        self.destinations = destinations
        self.showCoordinates = showCoordinates
        self.onSquareTap = onSquareTap
        // Seeded here rather than in `onAppear` so the first frame already has pieces on
        // it; a board that appears empty and fills in a tick later reads as a bug.
        _layout = State(initialValue: PieceLayout(snapshot: snapshot))
    }

    var body: some View {
        GeometryReader { proxy in
            let geometry = BoardGeometry(fitting: proxy.size, orientation: orientation)

            ZStack(alignment: .topLeading) {
                BoardSquaresLayer(
                    geometry: geometry,
                    lastMove: snapshot.lastMove,
                    highlights: highlightSquares.union(selectedSquare.map { [$0] } ?? []),
                    showCoordinates: showCoordinates
                )

                ForEach(layout.pieces) { placed in
                    PieceImage(piece: placed.piece)
                        .frame(width: geometry.squareSize, height: geometry.squareSize)
                        .position(geometry.center(of: placed.square))
                }

                if !destinations.isEmpty {
                    DestinationsLayer(
                        destinations: destinations,
                        occupied: Set(snapshot.pieces.keys),
                        geometry: geometry
                    )
                }

                ArrowsLayer(arrows: arrows, geometry: geometry)

                if let glyph {
                    GlyphBadge(glyph: glyph, geometry: geometry)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .contentShape(Rectangle())
            .modifier(SquareTap(geometry: geometry, action: onSquareTap))
        }
        .aspectRatio(1, contentMode: .fit)
        .onChange(of: snapshot) { previous, current in
            var next = layout
            if next.step(from: previous, to: current) {
                // A single ply forward or back: the pieces that stayed keep their identity,
                // so the one that moved slides. Short and eased-out, matching the web.
                withAnimation(.easeOut(duration: 0.18)) { layout = next }
            } else {
                // A jump, a different game, a flip of the move list — there is no honest
                // correspondence between the two positions, so rebuild and do not pretend
                // by sliding pieces to unrelated squares.
                next.rebuild(for: current)
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { layout = next }
            }
        }
    }
}

// MARK: - Squares

/// The 64 squares, the last-move tint and the coordinates.
///
/// Separate from `BoardView` because it never changes when a piece moves, only when the
/// board is flipped or a highlight changes, and because the previews of the other layers
/// want a board to sit on.
struct BoardSquaresLayer: View {
    let geometry: BoardGeometry
    let lastMove: LastMove?
    let highlights: Set<BoardSquare>
    let showCoordinates: Bool

    var body: some View {
        Canvas { context, _ in
            guard geometry.squareSize > 0 else { return }

            for square in BoardSquare.all {
                let frame = geometry.frame(of: square)
                context.fill(
                    Path(frame),
                    with: .color(square.isLight ? Theme.boardLight : Theme.boardDark)
                )

                // The last-move wash is the hueless `arrowPlayed` white rather than the
                // usual chess yellow. It lifts both square colours by the same amount, so
                // the pair reads as one highlight instead of two different ones, and it is
                // the same "this is what was actually played" language the played arrow
                // speaks — the board says it once, in one colour.
                if square == lastMove?.from || square == lastMove?.to {
                    context.fill(Path(frame), with: .color(Theme.arrowPlayed.opacity(0.28)))
                }

                if highlights.contains(square) {
                    context.fill(Path(frame), with: .color(Theme.accent.opacity(0.30)))
                }
            }

            guard showCoordinates else { return }

            // In the board's own corners, the way chessground and the web app draw them:
            // a rank number in the top-left of the leftmost column, a file letter in the
            // bottom-right of the bottom row. Both are view-relative, so flipping the board
            // moves them to the ranks and files that are now on those edges.
            let inset = geometry.squareSize * 0.06
            let size = max(7, geometry.squareSize * 0.20)

            for square in BoardSquare.all {
                let frame = geometry.frame(of: square)
                let ink = square.isLight ? Theme.coordOnLight : Theme.coordOnDark

                if geometry.column(of: square) == 0 {
                    context.draw(
                        Text(verbatim: "\(square.rank + 1)")
                            .font(Theme.Font.text(size, weight: .semibold))
                            .foregroundStyle(ink),
                        at: CGPoint(x: frame.minX + inset, y: frame.minY + inset),
                        anchor: .topLeading
                    )
                }

                if geometry.row(of: square) == 7 {
                    let letter = String(square.algebraic.prefix(1))
                    context.draw(
                        Text(letter)
                            .font(Theme.Font.text(size, weight: .semibold))
                            .foregroundStyle(ink),
                        at: CGPoint(x: frame.maxX - inset, y: frame.maxY - inset),
                        anchor: .bottomTrailing
                    )
                }
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Taps

/// Attaches the tap gesture only when there is somewhere to send it, so a board with no
/// handler does not swallow a scroll or a swipe from whatever it is embedded in.
private struct SquareTap: ViewModifier {
    let geometry: BoardGeometry
    let action: ((BoardSquare) -> Void)?

    func body(content: Content) -> some View {
        if let action {
            content.onTapGesture(count: 1, coordinateSpace: .local) { location in
                if let square = geometry.square(at: location) { action(square) }
            }
        } else {
            content
        }
    }
}

// MARK: - Piece identity

/// One piece on the board, with an identity that survives a move.
struct PlacedPiece: Identifiable, Equatable {
    let id: Int
    var piece: ChessPiece
    var square: BoardSquare
}

/// What makes a piece slide instead of cross-fade.
///
/// A `Snapshot` is a map from square to piece, which is everything needed to *draw* a
/// position and nothing needed to *animate* between two of them: the two dictionaries have
/// no notion of "the same knight". Rendered straight, SwiftUI sees a knight disappear from
/// b1 and a different knight appear on c3, and cross-fades them. A chess board that
/// cross-fades looks broken.
///
/// So identity is carried here, outside the snapshots. Each piece gets an integer id that
/// follows it: on a single ply forward the piece standing on `lastMove.from` keeps its id
/// and takes the destination square, and SwiftUI, seeing the same id at a new `.position`,
/// slides it. Stepping back does the same in reverse.
///
/// **The limit, honestly.** This reconciliation only understands a step of exactly one ply
/// in either direction, and it derives the moved piece from the *square* the move names,
/// not from any real identity — two knights that could both have reached c3 are
/// indistinguishable, and the one on the from-square is the one that moves, which is
/// always correct for a real move but is a coincidence of the data rather than knowledge.
/// Anything else — a jump to another ply, a new game, a scrub — rebuilds with fresh ids
/// and cross-fades, which is the right look for a jump anyway.
///
/// After every step the layout is reconciled against the snapshot it claims to show
/// (`patch`), so a piece the step logic got wrong is dropped and re-added rather than
/// drawn in the wrong place. A reconciliation bug can therefore cost an animation. It
/// cannot show a wrong board.
struct PieceLayout {
    private(set) var pieces: [PlacedPiece] = []
    private var nextID = 0

    init(snapshot: Snapshot) {
        rebuild(for: snapshot)
    }

    /// Throws away every identity and starts again from the snapshot. New ids mean SwiftUI
    /// replaces rather than moves, which is what a jump should look like.
    mutating func rebuild(for snapshot: Snapshot) {
        pieces = []
        patch(to: snapshot.pieces)
    }

    /// Carries identities from `previous` to `current` if the two are one ply apart.
    /// Returns false when they are not, leaving the layout untouched for the caller to
    /// rebuild.
    mutating func step(from previous: Snapshot, to current: Snapshot) -> Bool {
        // `forward` is always the move as the game played it; `move` is the step being
        // taken now, which is the same thing reversed when the reader steps back. Keeping
        // both matters: anything that reads a *direction* off the move — which side the
        // king castled to, above all — has to read it from the game's move, not from the
        // reader's.
        let forward: LastMove
        let undoing: Bool
        if current.ply == previous.ply + 1, let last = current.lastMove {
            forward = last
            undoing = false
        } else if current.ply == previous.ply - 1, let last = previous.lastMove {
            forward = last
            undoing = true
        } else {
            return false
        }
        let move = undoing ? LastMove(from: forward.to, to: forward.from) : forward

        guard let moverIndex = pieces.firstIndex(where: { $0.square == move.from }) else {
            return false
        }
        let moverID = pieces[moverIndex].id
        let mover = pieces[moverIndex].piece

        // Castling is one UCI move but two pieces. Without this the rook is dropped by the
        // patch below and fades in on f1, next to a king that slid — which looks like the
        // rook teleported, because it did.
        if mover.kind == .king, abs(forward.to.file - forward.from.file) == 2,
            forward.to.rank == forward.from.rank
        {
            let kingside = forward.to.file > forward.from.file
            let rookFrom = BoardSquare(file: kingside ? 7 : 0, rank: forward.from.rank)
            let rookTo = BoardSquare(file: kingside ? 5 : 3, rank: forward.from.rank)
            // Undoing a castle runs the same two squares the other way round.
            let start = undoing ? rookTo : rookFrom
            let finish = undoing ? rookFrom : rookTo
            if let start, let finish,
                let rookIndex = pieces.firstIndex(where: { $0.square == start })
            {
                pieces[rookIndex].square = finish
            }
        }

        if let index = pieces.firstIndex(where: { $0.id == moverID }) {
            pieces[index].square = move.to
            // A promoted pawn keeps its identity and changes kind, so the piece that
            // crossed the board is the piece that becomes a queen.
            if let arrived = current.pieces[move.to] { pieces[index].piece = arrived }
        }

        patch(to: current.pieces)
        return true
    }

    /// Makes the list agree with the target map, keeping every piece that is already
    /// standing where the target says it should be and giving a fresh identity to
    /// everything else. This is what makes a captured piece vanish, an undone capture
    /// reappear, and a mis-stepped piece degrade to a fade rather than a lie.
    private mutating func patch(to target: [BoardSquare: ChessPiece]) {
        var kept: Set<BoardSquare> = []
        pieces.removeAll { placed in
            guard !kept.contains(placed.square), target[placed.square] == placed.piece else {
                return true
            }
            kept.insert(placed.square)
            return false
        }

        for square in target.keys.sorted() where !kept.contains(square) {
            guard let piece = target[square] else { continue }
            pieces.append(PlacedPiece(id: nextID, piece: piece, square: square))
            nextID += 1
        }
    }
}

// MARK: - Previews

#Preview("Opening, arrows and a blunder") {
    let moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "f3g5", "d7d5"]
    let snapshots = Replay.snapshots(
        from: moves.enumerated().map { ReplayMove(ply: $0.offset + 1, uci: $0.element) }
    )

    return HStack(alignment: .top, spacing: Theme.Metrics.gutter) {
        EvalBarView(whiteWin: 63, scoreLabel: "+0.7")
        BoardView(
            snapshot: snapshots.last ?? snapshots[0],
            arrows: [
                BoardArrow(
                    from: BoardSquare(algebraic: "e4") ?? .a1,
                    to: BoardSquare(algebraic: "d5") ?? .a1,
                    kind: .engine,
                    label: "1"
                ),
                BoardArrow(
                    from: BoardSquare(algebraic: "g5") ?? .a1,
                    to: BoardSquare(algebraic: "f7") ?? .a1,
                    kind: .maia,
                    label: "41%"
                ),
                BoardArrow(
                    from: BoardSquare(algebraic: "d7") ?? .a1,
                    to: BoardSquare(algebraic: "d5") ?? .a1,
                    kind: .played
                ),
            ],
            glyph: .inaccuracy(on: BoardSquare(algebraic: "d5") ?? .a1)
        )
    }
    .padding(Theme.Metrics.gutter)
    .background(Theme.void)
}

#Preview("Flipped, no coordinates") {
    BoardView(
        snapshot: Replay.snapshots(from: [ReplayMove(ply: 1, uci: "e2e4")]).last
            ?? Snapshot(ply: 0, pieces: [:], lastMove: nil, sideToMove: .white, fen: ""),
        orientation: .black,
        showCoordinates: false
    )
    .padding()
    .background(Theme.void)
}

/// Where a selected piece may go.
///
/// An empty square gets a dot in its middle; an occupied one gets a ring around its edge
/// instead, because a dot drawn on top of a piece hides the piece it is about and a capture
/// is the move most worth seeing clearly. Both are drawn over the pieces rather than under
/// them, since a marker a piece can cover is a marker that disappears exactly when it
/// matters.
struct DestinationsLayer: View {
    let destinations: Set<BoardSquare>
    let occupied: Set<BoardSquare>
    let geometry: BoardGeometry

    var body: some View {
        Canvas { context, _ in
            let square = geometry.squareSize
            guard square > 0 else { return }

            for target in destinations {
                let centre = geometry.center(of: target)
                if occupied.contains(target) {
                    let inset = square * 0.06
                    let side = square - inset * 2
                    let rect = CGRect(
                        x: centre.x - side / 2,
                        y: centre.y - side / 2,
                        width: side,
                        height: side
                    )
                    context.stroke(
                        Path(ellipseIn: rect),
                        with: .color(Theme.accent.opacity(0.75)),
                        lineWidth: square * 0.075
                    )
                } else {
                    let radius = square * 0.16
                    let rect = CGRect(
                        x: centre.x - radius,
                        y: centre.y - radius,
                        width: radius * 2,
                        height: radius * 2
                    )
                    context.fill(Path(ellipseIn: rect), with: .color(Theme.accent.opacity(0.55)))
                }
            }
        }
        .allowsHitTesting(false)
    }
}
