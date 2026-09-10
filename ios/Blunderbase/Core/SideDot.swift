import SwiftUI

/// A side, as a scoresheet writes it: a filled disc for White, a ringed one for Black.
///
/// Readable at nine points where a piece glyph would not be, and the same mark wherever a
/// side is named — the players strip over the board, the games rows, a note's anchor — so
/// "which colour did I have" is answered by one shape everywhere rather than by a bold
/// name here and a word there. It brightens with an accent ring for whoever is to move,
/// which only the board's strip asks for.
struct SideDot: View {
    let isWhite: Bool
    var toMove: Bool = false
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(isWhite ? Theme.sideWhite : Theme.sideBlack)
            .overlay(Circle().strokeBorder(isWhite ? Theme.sideWhiteEdge : Theme.sideBlackEdge, lineWidth: 1))
            .frame(width: size, height: size)
            .overlay {
                if toMove {
                    Circle().strokeBorder(Theme.accent, lineWidth: 1.5).frame(width: size + 5, height: size + 5)
                }
            }
            .accessibilityHidden(true)
    }
}

/// The result as a small filled chip: `1–0` on a green ground when the owner won, red when
/// they lost, the neutral chip ground for a draw, an unfinished game or a game the owner
/// did not play. The digits were tinted before; a ground is what lets a scan down the right
/// edge of a list read wins and losses as shapes rather than as colours of the same shape.
struct ResultChip: View {
    let result: String?
    let outcome: String?

    var body: some View {
        Text(Format.result(result))
            .font(Theme.Font.mono(12, weight: .semibold))
            .foregroundStyle(ink)
            .padding(.horizontal, 6)
            .frame(height: 20)
            .background(ground, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.chip).strokeBorder(edge, lineWidth: 0.5))
            .fixedSize()
    }

    private var ink: Color {
        switch outcome {
        case "win": return Theme.good
        case "loss": return Theme.blunder
        default: return Theme.muted
        }
    }

    private var ground: Color {
        switch outcome {
        case "win": return Theme.chipGood
        case "loss": return Theme.chipBad
        default: return Theme.elevated
        }
    }

    private var edge: Color {
        switch outcome {
        case "win": return Theme.chipGoodEdge
        case "loss": return Theme.chipBadEdge
        default: return Theme.edge
        }
    }
}
