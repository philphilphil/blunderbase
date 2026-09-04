import SwiftUI

/// The shape of a game, at the size of a postage stamp.
///
/// A games list is scanned, not read, and the one thing a row cannot say in words is
/// *how* the game went — level for forty moves then falling off a cliff looks nothing like
/// slowly losing, and both spell "0–1". This is `EvalStrip` with everything that makes a
/// strip steerable taken out: no cursor, no gesture, no ticks a thumb could hit. It is a
/// picture, and the row it sits in is the control.
///
/// Two decisions carry the whole file:
///
/// - **A gap is drawn as a gap.** A ply whose `win` is nil was not analysed; filling it in
///   as zero would draw a cliff into a lost position that never happened, which is exactly
///   the shape a reader is scanning for. Runs of consecutive analysed plies are filled
///   separately and the unanalysed stretches stay empty track.
/// - **x is the ply, not the index.** Skipping the nils would otherwise squeeze the drawn
///   part of the curve across the full width and put the collapse in the wrong place.
struct Sparkline: View {
    /// White's win percentage per ply, 0…100, in the order the server sent it.
    let points: [EvalPoint]
    /// Plies the analysis flagged, marked with a hairline so the row's `??1 ?2` chips have
    /// somewhere to point. Empty is the common case and draws nothing.
    var flagged: [Int] = []

    var body: some View {
        Canvas { context, size in
            draw(in: &context, size: size)
        }
        .background(Theme.graphBg, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.chip))
        .accessibilityHidden(true)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }

        // Equality, so that "White is winning" is a place on the stamp rather than a value
        // to work out. Drawn even for a game with no curve, so an unanalysed row still
        // reads as an empty track rather than as a blank.
        let midline = Path { path in
            path.move(to: CGPoint(x: 0, y: size.height / 2))
            path.addLine(to: CGPoint(x: size.width, y: size.height / 2))
        }
        context.stroke(midline, with: .color(Theme.graphGrid), lineWidth: 0.5)

        guard points.count >= 2,
              let first = points.first?.ply,
              let last = points.last?.ply,
              last > first
        else { return }

        let span = CGFloat(last - first)
        func x(_ ply: Int) -> CGFloat { CGFloat(ply - first) / span * size.width }
        func y(_ win: Double) -> CGFloat {
            size.height - size.height * CGFloat(min(max(win, 0), 100) / 100)
        }

        for run in analysedRuns() where run.count >= 2 {
            var path = Path()
            path.move(to: CGPoint(x: x(run[0].ply), y: size.height))
            for point in run {
                guard let win = point.win else { continue }
                path.addLine(to: CGPoint(x: x(point.ply), y: y(win)))
            }
            if let end = run.last {
                path.addLine(to: CGPoint(x: x(end.ply), y: size.height))
            }
            path.closeSubpath()
            context.fill(path, with: .color(Theme.sideWhite.opacity(0.7)))
        }

        for ply in flagged where ply >= first && ply <= last {
            let tick = Path { path in
                path.move(to: CGPoint(x: x(ply), y: 0))
                path.addLine(to: CGPoint(x: x(ply), y: size.height))
            }
            context.stroke(tick, with: .color(Theme.blunder.opacity(0.55)), lineWidth: 1)
        }
    }

    /// The curve split into stretches the engine actually judged.
    ///
    /// A single isolated analysed ply between two gaps is dropped: one point has no area,
    /// and a one-pixel spike out of an empty track would read as a moment rather than as
    /// the sliver of data it is.
    private func analysedRuns() -> [[EvalPoint]] {
        var runs: [[EvalPoint]] = []
        var current: [EvalPoint] = []
        for point in points {
            if point.win == nil {
                if !current.isEmpty { runs.append(current) }
                current = []
            } else {
                current.append(point)
            }
        }
        if !current.isEmpty { runs.append(current) }
        return runs
    }
}

/// Curve fixtures for the preview: a wave, a game analysed only to move twenty, nothing.
private enum SparklinePreview {
    static func curve(_ wins: [Double?]) -> [EvalPoint] {
        wins.enumerated().map { EvalPoint(ply: $0.offset, win: $0.element) }
    }

    static let swinging = curve((0..<40).map { 50 + 40 * sin(Double($0) / 6) })
    static let halfAnalysed = curve((0..<40).map { $0 < 20 ? 52 : nil })
}

#Preview("Sparkline") {
    VStack(alignment: .leading, spacing: 14) {
        Sparkline(points: SparklinePreview.swinging, flagged: [18])
            .frame(width: 46, height: 22)
        Sparkline(points: SparklinePreview.halfAnalysed)
            .frame(width: 46, height: 22)
        Sparkline(points: [])
            .frame(width: 46, height: 22)
    }
    .padding()
    .background(Theme.void)
}
