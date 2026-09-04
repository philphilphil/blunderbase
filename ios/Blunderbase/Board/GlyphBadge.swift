import SwiftUI

/// The classification marker: `??`, `?`, `?!` on the square a flagged move landed on.
///
/// The move list already carries these glyphs, but the whole point of stepping through a
/// game on this app is that the reader is looking at the *board*. Putting the mark on the
/// destination square means the answer to "why am I looking at this position" is on the
/// same square as the move that caused it, and the reader never has to glance away.
struct BoardGlyph: Equatable {
    let square: BoardSquare
    /// `"??"`, `"?"`, `"?!"` — text rather than an enum, so a new classification on the
    /// server does not need an app release to be displayed.
    let text: String
    /// The badge fill: one of the classification colours.
    let color: Color
    /// The text colour. Defaults to the darkest ground in the palette, which reads on every
    /// classification hue.
    var ink: Color = Theme.void

    init(square: BoardSquare, text: String, color: Color, ink: Color = Theme.void) {
        self.square = square
        self.text = text
        self.color = color
        self.ink = ink
    }

    static func blunder(on square: BoardSquare) -> BoardGlyph {
        BoardGlyph(square: square, text: "??", color: Theme.blunder, ink: Theme.blunderInk)
    }

    static func mistake(on square: BoardSquare) -> BoardGlyph {
        BoardGlyph(square: square, text: "?", color: Theme.mistake, ink: Theme.mistakeInk)
    }

    /// The palette has no inaccuracy ink — the web only ever draws that yellow as a border,
    /// never as a filled surface with text on it. The mistake ink is the same warm near-black
    /// and carries on the yellow, so it stands in rather than inventing a thirteenth token.
    static func inaccuracy(on square: BoardSquare) -> BoardGlyph {
        BoardGlyph(square: square, text: "?!", color: Theme.inaccuracy, ink: Theme.mistakeInk)
    }
}

/// Draws one glyph on its square.
///
/// It overhangs the square's top-right corner rather than sitting inside it: inside, the
/// badge fights the piece for the middle of the square; overhanging, it reads as a note
/// pinned to the square, and the corner it hangs off is the one a piece's silhouette is
/// least likely to occupy.
struct GlyphBadge: View {
    let glyph: BoardGlyph
    let geometry: BoardGeometry

    /// A third of a square: big enough that `?!` is legible at iPhone board size, small
    /// enough that it does not read as a piece.
    private static let sizeRatio: CGFloat = 0.34

    var body: some View {
        let side = geometry.squareSize * Self.sizeRatio
        let frame = geometry.frame(of: glyph.square)

        Text(glyph.text)
            .font(Theme.Font.text(side * 0.56, weight: .heavy))
            .foregroundStyle(glyph.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .padding(.horizontal, side * 0.14)
            .frame(minWidth: side, minHeight: side)
            .background(
                RoundedRectangle(cornerRadius: side * 0.3, style: .continuous)
                    .fill(glyph.color)
            )
            .position(x: frame.maxX - side * 0.25, y: frame.minY + side * 0.25)
            .allowsHitTesting(false)
            .accessibilityLabel(Text(accessibilityText))
    }

    private var accessibilityText: String {
        switch glyph.text {
        case "??": "Blunder on \(glyph.square.algebraic)"
        case "?": "Mistake on \(glyph.square.algebraic)"
        case "?!": "Inaccuracy on \(glyph.square.algebraic)"
        default: "\(glyph.text) on \(glyph.square.algebraic)"
        }
    }
}

#Preview("Classifications") {
    GeometryReader { proxy in
        let geometry = BoardGeometry(fitting: proxy.size)
        ZStack {
            BoardSquaresLayer(geometry: geometry, lastMove: nil, highlights: [], showCoordinates: true)
            GlyphBadge(glyph: .blunder(on: BoardSquare(algebraic: "e4") ?? .a1), geometry: geometry)
            GlyphBadge(glyph: .mistake(on: BoardSquare(algebraic: "c6") ?? .a1), geometry: geometry)
            GlyphBadge(glyph: .inaccuracy(on: BoardSquare(algebraic: "g7") ?? .a1), geometry: geometry)
        }
    }
    .aspectRatio(1, contentMode: .fit)
    .padding()
    .background(Theme.void)
}
