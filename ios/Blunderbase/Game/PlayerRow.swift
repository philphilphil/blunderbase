import SwiftUI

/// Both players in one strip above the board: who they are, what they were rated, and what
/// their clocks said at the position on the board.
///
/// One strip rather than a row above the board and a row below it. The screen's height is
/// the board and the panes trading one column, and a row between them was 34 points that
/// separated the two things the reader looks between most; above the board it costs the
/// same and separates nothing. The side whose pieces are at the bottom reads first, which
/// is the owner unless the board is flipped, and the dot says the colour either way.
struct PlayersRow: View {
    let near: PlayerRow
    let far: PlayerRow

    var body: some View {
        HStack(spacing: 0) {
            near
            Divider().overlay(Theme.hairline).frame(height: 18).padding(.horizontal, 10)
            far
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .frame(height: 34)
        .background(Theme.surface)
    }
}

/// One player's half of the strip.
///
/// The two halves mirror each other: dot and name at the outer edges, rating and clock
/// toward the middle. Two halves in the same reading order put one player's clock against
/// the other's dot and read as one long row of six things; mirrored, the strip reads as two
/// players facing each other across the divider, which is what they are.
///
/// The clock is the reason this view is bound to the cursor rather than drawn once. Time
/// is half the story of a bad move, and a clock that only shows the final time hides
/// exactly the part worth seeing — that the blunder came with forty seconds left. The name
/// is what gives way when the half is narrow: the rating and the clock are short and
/// exact, and a name cut to "Hikar…" is still the name.
struct PlayerRow: View {
    let name: String?
    let rating: Int?
    let isWhite: Bool
    let isOwner: Bool
    let clock: Double?
    let toMove: Bool
    /// True for the right-hand half, which lays the same parts out right to left.
    var mirrored: Bool = false

    var body: some View {
        HStack(spacing: 6) {
            if mirrored {
                clockText
                Spacer(minLength: 4)
                ratingText
                nameText
                sideDot
            } else {
                sideDot
                nameText
                ratingText
                Spacer(minLength: 4)
                clockText
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var nameText: some View {
        Text(name ?? "Unknown")
            .font(Theme.Font.text(14, weight: isOwner ? .semibold : .regular))
            .foregroundStyle(isOwner ? Theme.text : Theme.body2)
            .lineLimit(1)
            .truncationMode(.tail)
            .layoutPriority(-1)
    }

    @ViewBuilder
    private var ratingText: some View {
        if let rating {
            Text(verbatim: "\(rating)")
                .font(Theme.Font.mono(12))
                .foregroundStyle(Theme.dim2)
        }
    }

    @ViewBuilder
    private var clockText: some View {
        if let clock {
            Text(Format.clock(clock))
                .font(Theme.Font.mono(13, weight: .medium))
                .foregroundStyle(Format.clockColor(clock))
                .monospacedDigit()
        }
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
    PlayersRow(
        near: PlayerRow(name: "phib", rating: 1690, isWhite: true, isOwner: true, clock: 238, toMove: false),
        far: PlayerRow(name: "Hikaru", rating: 2812, isWhite: false, isOwner: false, clock: 12, toMove: true, mirrored: true)
    )
    .background(Theme.void)
}
