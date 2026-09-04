import SwiftUI
import Charts

/// The shape of the game, at the size you can actually read, plus the list of the moves
/// that made it that shape.
///
/// The strip under the board answers "did this game turn"; this answers "where, and which
/// move was it". The two are the same data drawn twice on purpose, and the split follows
/// the web's reasoning: the plot says the game turned and roughly where, the list says
/// which move it was, and a finger can hit a row where it cannot hit a column two points
/// wide.
struct EvalPane: View {
    @Bindable var store: GameStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                tallies
                chart
                flaggedList
            }
        }
    }

    // MARK: Tallies

    /// Each player's flagged moves and what they cost on average. Owner's side first, since
    /// that is the side the reader is here about.
    private var tallies: some View {
        HStack(alignment: .top, spacing: 0) {
            tally(store.tally(forWhite: true), name: store.detail?.game.white, isWhite: true)
            Divider().overlay(Theme.hairline).frame(height: 34)
            tally(store.tally(forWhite: false), name: store.detail?.game.black, isWhite: false)
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.vertical, 8)
    }

    private func tally(_ tally: GameStore.Tally, name: String?, isWhite: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                Circle()
                    .fill(isWhite ? Theme.sideWhite : Theme.sideBlack)
                    .overlay(Circle().strokeBorder(isWhite ? Theme.sideWhiteEdge : Theme.sideBlackEdge, lineWidth: 1))
                    .frame(width: 8, height: 8)
                Text(name ?? (isWhite ? "White" : "Black"))
                    .font(Theme.Font.text(12))
                    .foregroundStyle(Theme.dim)
                    .lineLimit(1)
            }
            HStack(spacing: 8) {
                counter(tally.blunders, glyph: "??", color: Theme.blunder)
                counter(tally.mistakes, glyph: "?", color: Theme.mistake)
                counter(tally.inaccuracies, glyph: "?!", color: Theme.inaccuracy)
                if let average = tally.averageLoss {
                    Text(String(format: "%.1f%% avg", average))
                        .font(Theme.Font.mono(11))
                        .foregroundStyle(Theme.faint)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
    }

    @ViewBuilder
    private func counter(_ count: Int, glyph: String, color: Color) -> some View {
        HStack(spacing: 2) {
            Text(glyph)
                .font(Theme.Font.mono(12, weight: .bold))
                .foregroundStyle(count > 0 ? color : Theme.faint2)
            Text(verbatim: "\(count)")
                .font(Theme.Font.mono(12))
                .foregroundStyle(count > 0 ? Theme.body2 : Theme.faint2)
        }
    }

    // MARK: Chart

    /// White's share of the win across the game, as a filled line.
    ///
    /// The area is the reading: how much of the column is White's, at a glance, the same
    /// question the eval bar beside the board answers for one position. The line on top is
    /// what makes a single sharp move visible, because an area edge alone gets lost against
    /// the fill at this height.
    ///
    /// Interpolation is monotone rather than straight segments: it keeps the curve from
    /// overshooting past a value the game never had, which a spline would do at exactly the
    /// moments that matter here — a sharp drop on a blunder.
    ///
    /// **Solid white on the full-strength plot ground**, which is the web's treatment
    /// (`web/src/routes/game/components/EvalGraph.tsx`) and lichess's before it. The two used
    /// to be mixed down — a 28 % white area over a 40 % ground — which read on the dark
    /// theme and became near-white on near-white the moment the light theme existed, because
    /// `sideWhite` is white in both themes and the ground it was diluted against is not. At
    /// full strength the plot is its own surface and the fill is a colour rather than a tint,
    /// so the same picture works either way round. The line is `sideWhiteEdge` for the same
    /// reason the web rims its bars: it is the boundary of the white shape, and it has to
    /// read against the fill on one side and the ground on the other.
    private var chart: some View {
        Chart {
            ForEach(store.curve) { point in
                AreaMark(
                    x: .value("Ply", point.ply),
                    y: .value("Win", point.win)
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(Theme.sideWhite)
            }

            ForEach(store.curve) { point in
                LineMark(
                    x: .value("Ply", point.ply),
                    y: .value("Win", point.win)
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 1.5))
                .foregroundStyle(Theme.sideWhiteEdge)
            }

            ForEach(store.curve.filter { $0.classification.isFlagged }) { point in
                // On the curve rather than pinned to the top: a mark at the value shows what
                // the move cost as well as that it was flagged.
                PointMark(
                    x: .value("Ply", point.ply),
                    y: .value("Win", point.win)
                )
                .symbolSize(28)
                .foregroundStyle(point.classification.color)
            }

            RuleMark(y: .value("Level", 50))
                .foregroundStyle(Theme.graphGrid)
                .lineStyle(StrokeStyle(lineWidth: 0.5, dash: [3, 3]))

            RuleMark(x: .value("Cursor", store.cursor))
                .foregroundStyle(Theme.accent)
                .lineStyle(StrokeStyle(lineWidth: 1.5))
        }
        .chartYScale(domain: 0...100)
        // The x axis is the game's length, not the curve's. Left to itself the chart picks a
        // "nice" upper bound past the last point, and the plot ends short of the right edge
        // by whatever the rounding added — a game of 41 moves drawn as if it had 45. The
        // domain is fixed to the move count so the last move sits on the edge, and so the
        // cursor rule and a tap on the plot map to the same ply the curve does.
        .chartXScale(domain: 0...max(store.moves.count, 1))
        .chartYAxis {
            AxisMarks(values: [0, 50, 100]) {
                AxisValueLabel()
                    .font(Theme.Font.mono(9))
                    .foregroundStyle(Theme.graphTick)
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 5)) { value in
                AxisValueLabel {
                    // The axis is the cursor — half-moves played — and the label is the whole
                    // move a reader counts in. After `n` half-moves the move that arrived is
                    // number `(n + 1) / 2`: 1 and 2 are both move 1, 3 and 4 both move 2.
                    if let count = value.as(Int.self) {
                        Text(verbatim: "\((count + 1) / 2)")
                            .font(Theme.Font.mono(9))
                            .foregroundStyle(Theme.graphTick)
                    }
                }
            }
        }
        .chartOverlay { proxy in
            // Tap or drag anywhere on the plot to move the game there. The chart is a
            // control, not an illustration — and the axis is already the cursor's scale, so
            // the value under the finger is the cursor to seek to.
            GeometryReader { geometry in
                Rectangle()
                    .fill(.clear)
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0).onChanged { value in
                            guard let plotFrame = proxy.plotFrame else { return }
                            let x = value.location.x - geometry[plotFrame].origin.x
                            if let count: Int = proxy.value(atX: x) {
                                store.seek(to: count)
                            }
                        }
                    )
            }
        }
        .frame(height: 140)
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.bottom, 12)
        .background(Theme.graphBg)
    }

    // MARK: Flagged list

    @ViewBuilder
    private var flaggedList: some View {
        if store.flaggedMoves.isEmpty {
            Text(store.detail?.runs.isEmpty == true
                 ? "This game has not been analysed yet."
                 : "The engine flagged nothing in this game.")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
                .padding(Theme.Metrics.gutter)
        } else {
            VStack(spacing: 0) {
                ForEach(store.flaggedMoves, id: \.ply) { move in
                    Button {
                        // Land on the position the mistake was made *from*: the question at a
                        // blunder is what should have been played here, and that is only
                        // answerable from the square before it. A move's 0-based ply already
                        // is the cursor it was played from, so there is nothing to convert.
                        store.seek(to: move.ply)
                    } label: {
                        HStack(spacing: 8) {
                            Text(move.classification.glyph)
                                .font(Theme.Font.mono(12, weight: .bold))
                                .foregroundStyle(move.classification.ink)
                                .frame(width: 24, height: 18)
                                .background(move.classification.color, in: RoundedRectangle(cornerRadius: Theme.Radius.chip))

                            Text(Format.move(ply: move.ply, san: move.san))
                                .font(Theme.Font.mono(13, weight: .medium))
                                .foregroundStyle(Theme.body)

                            Spacer(minLength: 4)

                            if let best = move.bestLines?.first?.moveSan ?? move.bestMoveUci {
                                Text(best)
                                    .font(Theme.Font.mono(12))
                                    .foregroundStyle(Theme.arrowEngine)
                            }

                            Text(Format.winLoss(move.winLoss))
                                .font(Theme.Font.mono(13))
                                .foregroundStyle(move.classification.color)
                                .frame(width: 48, alignment: .trailing)
                        }
                        .padding(.horizontal, Theme.Metrics.gutter)
                        .frame(height: 38)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(store.cursor == move.ply ? Theme.rowActive : .clear)

                    Divider().overlay(Theme.hairline).padding(.leading, Theme.Metrics.gutter)
                }
            }
        }
    }
}
