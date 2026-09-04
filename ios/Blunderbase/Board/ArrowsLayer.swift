import SwiftUI

/// The arrows, which are the reason this board exists.
///
/// Blunderbase is not a play board. Nobody drags a piece here; the screen's job is to say
/// what the engine wanted, what Maia expected and what was actually played, all at once and
/// on the same position. Three standing arrows in three hues is how the web says it and
/// this is the phone's copy of that.

/// One arrow. `from`/`to` are board squares; everything about where it lands on screen is
/// the geometry's business.
struct BoardArrow: Identifiable, Equatable {
    let from: BoardSquare
    let to: BoardSquare
    let kind: Kind
    /// A small badge at the head — a rank number for an engine line, a policy percentage
    /// for Maia. Nil draws no badge.
    var label: String?

    /// Identity is the arrow itself, so re-supplying the same three arrows does not churn.
    var id: String { "\(kind.rawValue)-\(from.algebraic)\(to.algebraic)" }

    init(from: BoardSquare, to: BoardSquare, kind: Kind, label: String? = nil) {
        self.from = from
        self.to = to
        self.kind = kind
        self.label = label
    }

    /// What an arrow is claiming. The colour is a property of the claim, not of the caller,
    /// so no screen gets to invent its own engine blue.
    enum Kind: String, CaseIterable, Equatable {
        /// Stockfish's choice.
        case engine
        /// What Maia expects a human of this rating to play.
        case maia
        /// The move actually made in the game.
        case played
        /// A hovered or scrubbed line being previewed.
        case preview

        var color: Color {
            switch self {
            case .engine: Theme.arrowEngine
            case .maia: Theme.arrowMaia
            case .played: Theme.arrowPlayed
            case .preview: Theme.arrowDeep
            }
        }
    }
}

/// Draws every arrow in one `Canvas`.
///
/// One canvas rather than a view per arrow: three arrows are three paths and a few
/// triangles, and a single pass lets the layer nudge overlapping shafts apart with
/// knowledge of all of them at once, which a view per arrow could not do.
///
/// The layer sits **over** the pieces at 0.6 opacity, which is what the web does. Sliding
/// the played arrow underneath and the engine arrows over would need two canvases, which
/// splits the one thing this layer is for — knowing about all the arrows together — and
/// buys little: at 0.6 the piece reads through the shaft anyway, and an arrow hidden behind
/// a piece is an arrow the reader has to hunt for.
struct ArrowsLayer: View {
    let arrows: [BoardArrow]
    let geometry: BoardGeometry

    /// Proportions of a square. Chosen so an arrow is unmistakably an arrow at iPhone size:
    /// a thinner shaft disappears against the board texture and a bigger head swallows the
    /// destination piece.
    private enum Ratio {
        static let shaft: CGFloat = 0.16
        static let headWidth: CGFloat = 0.36
        static let headLength: CGFloat = 0.34
        /// How far short of the destination centre the tip stops, so the piece being
        /// pointed at is not covered by its own arrow.
        static let tipInset: CGFloat = 0.08
        /// Perpendicular separation between arrows leaving the same square.
        static let fan: CGFloat = 0.11
        static let badgeRadius: CGFloat = 0.17
    }

    var body: some View {
        Canvas { context, _ in
            let square = geometry.squareSize
            guard square > 0 else { return }

            // Arrows leaving the same square would otherwise sit exactly on top of each
            // other — the common case, since the engine and Maia often disagree about
            // where the same piece should go.
            var seenFrom: [BoardSquare: Int] = [:]

            for arrow in arrows {
                let rank = seenFrom[arrow.from, default: 0]
                seenFrom[arrow.from] = rank + 1
                draw(arrow, fanRank: rank, square: square, in: &context)
            }
        }
        .opacity(0.6)
        // The arrows are decoration over a board that already handles taps.
        .allowsHitTesting(false)
    }

    private func draw(
        _ arrow: BoardArrow,
        fanRank: Int,
        square: CGFloat,
        in context: inout GraphicsContext
    ) {
        let start = geometry.center(of: arrow.from)
        let end = geometry.center(of: arrow.to)

        // A knight's move is not a straight line. Drawing one as a diagonal makes Nb1-c3
        // read as a bishop move, which is the single most confusing thing an arrow layer
        // can do. The long leg goes first, then the short leg carries the head, which is
        // how the move is spoken: "two up, one across".
        let fileDelta = arrow.to.file - arrow.from.file
        let rankDelta = arrow.to.rank - arrow.from.rank
        let isKnightMove = Set([abs(fileDelta), abs(rankDelta)]) == Set([1, 2])
        let cornerSquare: BoardSquare? =
            isKnightMove
            ? (abs(fileDelta) == 2
                ? BoardSquare(file: arrow.to.file, rank: arrow.from.rank)
                : BoardSquare(file: arrow.from.file, rank: arrow.to.rank))
            : nil
        let corner = cornerSquare.map { geometry.center(of: $0) }

        // The head's direction is the direction of the last leg, not of the whole move.
        let approachFrom = corner ?? start
        guard let direction = unit(from: approachFrom, to: end) else { return }
        let perpendicular = CGPoint(x: -direction.y, y: direction.x)

        let tip = end - direction * (Ratio.tipInset * square)
        let shaftEnd = tip - direction * (Ratio.headLength * square)

        // Fan later arrows off the shared origin, and thin them slightly, so two arrows
        // from one square stay two arrows.
        let offset = fanOffset(rank: fanRank, square: square)
        let width = Ratio.shaft * square * (fanRank == 0 ? 1 : 0.8)
        let fanned = fanDirection(start: start, corner: corner, end: end)
        let shaftStart = start + fanned * offset

        var path = Path()
        path.move(to: shaftStart)
        if let corner { path.addLine(to: corner + fanned * (offset / 2)) }
        path.addLine(to: shaftEnd)

        let color = arrow.kind.color
        context.stroke(
            path,
            with: .color(color),
            style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
        )

        var head = Path()
        head.move(to: tip)
        head.addLine(to: shaftEnd + perpendicular * (Ratio.headWidth * square / 2))
        head.addLine(to: shaftEnd - perpendicular * (Ratio.headWidth * square / 2))
        head.closeSubpath()
        context.fill(head, with: .color(color))

        guard let label = arrow.label, !label.isEmpty else { return }
        // Beside the head rather than on it: a badge over the tip hides the thing the
        // arrow is pointing at, which is the one pixel the reader is looking for.
        let badgeCenter = tip + perpendicular * (Ratio.badgeRadius * square * 1.7)
        let radius = Ratio.badgeRadius * square
        context.fill(
            Path(ellipseIn: CGRect(
                x: badgeCenter.x - radius,
                y: badgeCenter.y - radius,
                width: radius * 2,
                height: radius * 2
            )),
            with: .color(color)
        )
        context.draw(
            Text(label)
                .font(Theme.Font.mono(radius * 1.05, weight: .bold))
                .foregroundStyle(Theme.void),
            at: badgeCenter,
            anchor: .center
        )
    }

    /// 0, +1, −1, +2, −2 … in units of `Ratio.fan`, so the first arrow from a square is
    /// exactly where it should be and the rest step out either side of it.
    private func fanOffset(rank: Int, square: CGFloat) -> CGFloat {
        guard rank > 0 else { return 0 }
        let step = CGFloat((rank + 1) / 2) * Ratio.fan * square
        return rank.isMultiple(of: 2) ? -step : step
    }

    /// The direction to fan along: perpendicular to the arrow's first leg, so the shafts
    /// separate sideways rather than sliding along each other.
    private func fanDirection(start: CGPoint, corner: CGPoint?, end: CGPoint) -> CGPoint {
        guard let direction = unit(from: start, to: corner ?? end) else { return .zero }
        return CGPoint(x: -direction.y, y: direction.x)
    }

    /// Nil for a zero-length move — a null move or corrupt data, which draws nothing rather
    /// than dividing by zero.
    private func unit(from: CGPoint, to: CGPoint) -> CGPoint? {
        let delta = CGPoint(x: to.x - from.x, y: to.y - from.y)
        let length = (delta.x * delta.x + delta.y * delta.y).squareRoot()
        guard length > 0.001 else { return nil }
        return CGPoint(x: delta.x / length, y: delta.y / length)
    }
}

// Small point arithmetic, private to the arrow maths so it does not become an app-wide
// vocabulary nobody asked for.
private func + (lhs: CGPoint, rhs: CGPoint) -> CGPoint {
    CGPoint(x: lhs.x + rhs.x, y: lhs.y + rhs.y)
}

private func - (lhs: CGPoint, rhs: CGPoint) -> CGPoint {
    CGPoint(x: lhs.x - rhs.x, y: lhs.y - rhs.y)
}

private func * (lhs: CGPoint, rhs: CGFloat) -> CGPoint {
    CGPoint(x: lhs.x * rhs, y: lhs.y * rhs)
}

#Preview("Three arrows and a knight") {
    let square = { (name: String) in BoardSquare(algebraic: name) ?? .a1 }
    return GeometryReader { proxy in
        let geometry = BoardGeometry(fitting: proxy.size)
        ZStack {
            Rectangle().fill(Theme.boardDark)
            ArrowsLayer(
                arrows: [
                    BoardArrow(from: square("g1"), to: square("f3"), kind: .engine, label: "1"),
                    BoardArrow(from: square("g1"), to: square("e2"), kind: .maia, label: "34%"),
                    BoardArrow(from: square("e2"), to: square("e4"), kind: .played),
                    BoardArrow(from: square("f1"), to: square("c4"), kind: .preview),
                ],
                geometry: geometry
            )
        }
    }
    .aspectRatio(1, contentMode: .fit)
    .padding()
    .background(Theme.void)
}
