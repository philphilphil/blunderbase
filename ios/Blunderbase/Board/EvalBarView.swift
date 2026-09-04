import SwiftUI

/// The thin column beside the board that says who is winning.
///
/// **Only the geometry follows the orientation. The number does not.** `whiteWin` is
/// always White's share of the position, whichever way up the board is drawn; what the
/// orientation decides is which end of the bar that share fills from — the side sitting at
/// the bottom of the board fills from the bottom of the bar, because the reader's own side
/// growing upward is the whole reason the bar is legible at a glance. Flipping the number
/// as well as the geometry is the bug everyone writes, and it produces a bar that is
/// silently correct for White and inverted for Black.
///
/// An unanalysed position draws a flat, dimmed 50/50 with no hairline. An empty track
/// would read as "0% for White", which is a much stronger claim than "nothing has looked
/// at this yet".
struct EvalBarView: View {
    /// White's win percentage, 0…100. Nil where nothing has evaluated the position.
    let whiteWin: Double?
    /// `"+1.4"`, `"M3"` — drawn small at the bar's foot. Nil draws nothing.
    let scoreLabel: String?
    /// The side at the bottom of the board, exactly as `BoardView` reads the same property.
    var orientation: PieceColor = .white

    private var known: Bool {
        guard let whiteWin else { return false }
        return whiteWin.isFinite
    }

    /// White's clamped share. 50 when unknown, so the geometry has something to draw.
    private var white: Double {
        guard let whiteWin, whiteWin.isFinite else { return 50 }
        return min(100, max(0, whiteWin))
    }

    /// The share belonging to whoever is at the bottom of the board.
    private var bottomShare: Double {
        orientation == .white ? white : 100 - white
    }

    var body: some View {
        GeometryReader { proxy in
            let height = proxy.size.height
            let bottomHeight = height * bottomShare / 100

            ZStack(alignment: .bottom) {
                // The track shows through wherever a fill is dimmed, which is what makes an
                // unanalysed bar look unfinished rather than lost.
                Rectangle().fill(Theme.evalTrack)

                Rectangle()
                    .fill(color(for: orientation.opposite))
                    .frame(height: max(0, height - bottomHeight))
                    .frame(maxHeight: .infinity, alignment: .top)

                Rectangle()
                    .fill(color(for: orientation))
                    .frame(height: bottomHeight)

                if known {
                    // The balance point. A hairline rather than a border, because it marks
                    // a value and not an edge.
                    Rectangle()
                        .fill(Theme.accent)
                        .frame(height: 1)
                        .offset(y: -bottomHeight)
                }
            }
            .opacity(known ? 1 : 0.45)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.chip, style: .continuous))
            // A spring rather than a linear ease: scrubbing a game moves this bar every few
            // milliseconds, and a spring that is already in flight retargets instead of
            // restarting, so a fast scrub reads as one continuous motion.
            .animation(.spring(response: 0.28, dampingFraction: 0.85), value: bottomShare)
            .animation(.easeOut(duration: 0.15), value: known)
        }
        .frame(width: Theme.Metrics.evalBarWidth)
        // The label is an overlay, not a row in a stack: it is wider than the 12pt column
        // and must not push the board sideways. It always sits at the foot of the bar, the
        // reader's own end, rather than following the winning side around — a number that
        // jumps from top to bottom while scrubbing is unreadable.
        .overlay(alignment: .bottom) {
            if let scoreLabel, !scoreLabel.isEmpty {
                Text(scoreLabel)
                    .font(Theme.Font.mono(9, weight: .semibold))
                    .foregroundStyle(Theme.dim)
                    .fixedSize()
                    .offset(y: 13)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text("Evaluation"))
        .accessibilityValue(Text(known ? "White \(Int(white.rounded())) percent" : "Not analysed"))
    }

    /// White's fill is the near-white ink, Black's the app's own ground: the two ends of
    /// the palette, so the boundary between them is the highest-contrast edge on screen.
    private func color(for side: PieceColor) -> Color {
        side == .white ? Theme.sideWhite : Theme.sideBlack
    }
}

#Preview("Eval bar") {
    HStack(spacing: 24) {
        EvalBarView(whiteWin: 72, scoreLabel: "+1.4")
        EvalBarView(whiteWin: 72, scoreLabel: "+1.4", orientation: .black)
        EvalBarView(whiteWin: 4, scoreLabel: "M3")
        EvalBarView(whiteWin: nil, scoreLabel: nil)
    }
    .frame(height: 320)
    .padding(32)
    .background(Theme.void)
}
