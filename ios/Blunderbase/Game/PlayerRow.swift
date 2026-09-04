import SwiftUI

/// One player's line above or below the board: who they are, what they were rated, and
/// what their clock said at the position on the board.
///
/// The clock is the reason this view is bound to the cursor rather than drawn once. Time
/// is half the story of a bad move, and a clock that only shows the final time hides
/// exactly the part worth seeing — that the blunder came with forty seconds left.
struct PlayerRow: View {
    let name: String?
    let rating: Int?
    let isWhite: Bool
    let isOwner: Bool
    let clock: Double?
    let toMove: Bool
    /// Sits between the rating and the clock, and only on the row that has one. This is
    /// where "back to game" goes: beside the reader's own name, on the side of the board
    /// they are playing from, rather than in a toolbar two thumb-lengths away.
    var trailing: AnyView? = nil

    var body: some View {
        HStack(spacing: 8) {
            sideDot
            Text(name ?? "Unknown")
                .font(Theme.Font.text(15, weight: isOwner ? .semibold : .regular))
                .foregroundStyle(isOwner ? Theme.text : Theme.body2)
                .lineLimit(1)
                .truncationMode(.tail)

            if let rating {
                Text(verbatim: "\(rating)")
                    .font(Theme.Font.mono(13))
                    .foregroundStyle(Theme.dim2)
            }

            Spacer(minLength: 8)

            if let trailing {
                trailing
            }

            if let clock {
                Text(Format.clock(clock))
                    .font(Theme.Font.mono(14, weight: .medium))
                    .foregroundStyle(Format.clockColor(clock))
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .frame(height: 34)
        .background(Theme.surface)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    /// A filled disc for White, a ringed one for Black — the same shorthand a scoresheet
    /// uses, and readable at this size where a piece glyph would not be. It brightens for
    /// whoever is to move, so the board's turn is legible without counting moves.
    private var sideDot: some View {
        Circle()
            .fill(isWhite ? Theme.sideWhite : Theme.sideBlack)
            .overlay(Circle().strokeBorder(isWhite ? Theme.sideWhiteEdge : Theme.sideBlackEdge, lineWidth: 1))
            .frame(width: 10, height: 10)
            .overlay {
                if toMove {
                    Circle().strokeBorder(Theme.accent, lineWidth: 1.5).frame(width: 15, height: 15)
                }
            }
    }

    private var accessibilityLabel: String {
        var parts = [name ?? "Unknown"]
        if let rating { parts.append("rated \(rating)") }
        parts.append(isWhite ? "white" : "black")
        if let clock { parts.append("clock \(Format.clock(clock))") }
        return parts.joined(separator: ", ")
    }
}

#Preview {
    VStack(spacing: 1) {
        PlayerRow(name: "Hikaru", rating: 2812, isWhite: false, isOwner: false, clock: 12, toMove: true)
        PlayerRow(name: "phib", rating: 1690, isWhite: true, isOwner: true, clock: 238, toMove: false)
    }
    .background(Theme.void)
}
