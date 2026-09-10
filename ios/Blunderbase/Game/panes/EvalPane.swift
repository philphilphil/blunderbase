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
                Text(name ?? (isWhite ? String(localized: "White") : String(localized: "Black")))
                    .font(Theme.Font.text(12))
                    .foregroundStyle(Theme.dim)
                    .lineLimit(1)
            }
            HStack(spacing: 8) {
                counter(tally.blunders, glyph: "??", color: Theme.blunder)
                counter(tally.mistakes, glyph: "?", color: Theme.mistake)
                counter(tally.inaccuracies, glyph: "?!", color: Theme.inaccuracy)
                if let average = tally.averageLoss {
                    // The percent sign rides inside the interpolation rather than in the
                    // key, where a bare `%` would be read as the start of a format.
                    Text("\(String(format: "%.1f%%", average)) avg")
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

    /// The 50 % axis: a level game, and the line every column stands on.
    private static let axis: Double = 50

    /// The measured width of the plot, which is what decides how wide a column is. Zero
    /// until the first layout, and the chart is drawn again the moment it is known.
    @State private var plotWidth: CGFloat = 0

    /// White's share of the win across the game, one column per ply.
    ///
    /// The web's default (`web/src/routes/game/components/EvalGraph.tsx`), and the reason it
    /// replaced the filled curve here: a column that starts on the axis and reaches up in
    /// White's tone or down in Black's names the side that is ahead by *pointing* at it,
    /// where the curve left over half the plot as a third grey belonging to nobody and asked
    /// the reader to hold the convention in their head. Every ply also becomes its own
    /// object, which is the honest picture of what the data is — the engine's verdict after
    /// each move, not a continuous quantity.
    ///
    /// Two side dots pinned to the plot's left edge are the key, as on the web, so there is
    /// no y axis to read: up is White, down is Black, and the quarter lines say how far.
    ///
    /// How wide a column is drawn is `EvalBars.layout`, the web's own rule: a gap and a
    /// rounded cap while there is room for them, a solid band once a long game leaves under
    /// two points a ply. The web also rims each column; a Swift Charts mark has no stroke,
    /// and the black tone clears the plot ground in both themes, so the rim is not missed.
    ///
    /// Blunders and mistakes wear their glyph on the tip of the column, outside the fill,
    /// for the owner's own moves — the ones the reader is here about — or for both sides on
    /// a game they did not play.
    private var chart: some View {
        let layout = EvalBars.layout(plotWidth: plotWidth, plies: store.moves.count)
        return Chart {
            RuleMark(y: .value("Level", 75))
                .foregroundStyle(Theme.graphGrid)
                .lineStyle(StrokeStyle(lineWidth: 1))
            RuleMark(y: .value("Level", 25))
                .foregroundStyle(Theme.graphGrid)
                .lineStyle(StrokeStyle(lineWidth: 1))

            ForEach(store.curve.dropFirst()) { point in
                BarMark(
                    x: .value("Ply", Double(point.ply)),
                    yStart: .value("Win", EvalPane.axis),
                    yEnd: .value("Win", point.win),
                    width: .fixed(layout.width)
                )
                .foregroundStyle(point.win >= EvalPane.axis ? Theme.sideWhite : Theme.sideBlack)
                .cornerRadius(layout.width >= 3 ? 1 : 0)
            }

            // The axis after the columns and the grid, so it stays on top of both.
            RuleMark(y: .value("Level", EvalPane.axis))
                .foregroundStyle(Theme.graphAxis)
                .lineStyle(StrokeStyle(lineWidth: 1))

            RuleMark(x: .value("Cursor", Double(store.cursor)))
                .foregroundStyle(Theme.accent)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))

            ForEach(markedPoints) { point in
                PointMark(
                    x: .value("Ply", Double(point.ply)),
                    y: .value("Win", point.win)
                )
                .symbolSize(0)
                .annotation(
                    // Outside the fill — up when White is ahead, down when Black is — and
                    // pulled back inside the plot at the ends of the game.
                    position: point.win >= EvalPane.axis ? .top : .bottom,
                    spacing: 3,
                    overflowResolution: .init(x: .fit(to: .plot), y: .fit(to: .plot))
                ) {
                    Text(point.classification.glyph)
                        .font(Theme.Font.mono(9, weight: .bold))
                        .foregroundStyle(point.classification.ink)
                        .padding(.horizontal, 3)
                        .frame(height: 11)
                        .background(point.classification.color, in: RoundedRectangle(cornerRadius: 2))
                }
            }
        }
        .chartYScale(domain: 0...100)
        // The x axis is the game's length, not the curve's. Left to itself the chart picks a
        // "nice" upper bound past the last point, and the plot ends short of the right edge
        // by whatever the rounding added — a game of 41 moves drawn as if it had 45. The
        // domain is the move count, padded by half a ply each side so the first and last
        // columns stand whole rather than cut down the middle by the plot's edge, and so the
        // cursor rule and a tap on the plot map to the same ply the columns do.
        .chartXScale(domain: -0.5...(Double(max(store.moves.count, 1)) + 0.5))
        .chartYAxis(.hidden)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 5)) { value in
                AxisValueLabel {
                    // The axis is the cursor — half-moves played — and the label is the whole
                    // move a reader counts in. After `n` half-moves the move that arrived is
                    // number `(n + 1) / 2`: 1 and 2 are both move 1, 3 and 4 both move 2.
                    // Nothing has arrived at count 0, so there is no move to number there.
                    if let count = value.as(Double.self).map({ Int($0.rounded()) }), count >= 1 {
                        Text(verbatim: "\((count + 1) / 2)")
                            .font(Theme.Font.mono(9))
                            .foregroundStyle(Theme.graphTick)
                    }
                }
            }
        }
        .chartBackground { proxy in
            // The key, and the ruler. The dots sit inside the plot's own corners, which is
            // the only place that is the plot's whichever way the axis labels fall; the
            // width goes to the state the columns are sized from.
            GeometryReader { geometry in
                if let plotFrame = proxy.plotFrame {
                    let plot = geometry[plotFrame]
                    sideDot(white: true)
                        .position(x: plot.minX + 7, y: plot.minY + 7)
                    sideDot(white: false)
                        .position(x: plot.minX + 7, y: plot.maxY - 7)
                    Color.clear
                        .onAppear { plotWidth = plot.width }
                        .onChange(of: plot.width) { _, width in plotWidth = width }
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
                            if let count: Double = proxy.value(atX: x) {
                                store.seek(to: Int(count.rounded()))
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

    /// The plies that wear a glyph on the plot: blunders and mistakes, as the web's legend
    /// explains and nothing else, and the owner's own where the owner is known. A point's
    /// ply is the *count* it arrived at, so the move that made it is the one before, and
    /// an even move ply is White's.
    private var markedPoints: [CurvePoint] {
        let owner = store.detail?.game.ownerIsWhite
        return store.curve.filter { point in
            guard point.classification == .blunder || point.classification == .mistake else {
                return false
            }
            guard let owner else { return true }
            let moverIsWhite = (point.ply - 1) % 2 == 0
            return moverIsWhite == owner
        }
    }

    /// The same disc the players' strip uses, small: the plot's whole key is "this end is
    /// White's".
    private func sideDot(white: Bool) -> some View {
        Circle()
            .fill(white ? Theme.sideWhite : Theme.sideBlack)
            .overlay(Circle().strokeBorder(white ? Theme.sideWhiteEdge : Theme.sideBlackEdge, lineWidth: 1))
            .frame(width: 8, height: 8)
            .accessibilityHidden(true)
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

/// The eval plot's column geometry, from the space it has and the plies it must fit — the
/// web's `barLayout` (`web/src/routes/game/gameModel.ts`), copied rather than re-derived so
/// the two plots degrade the same way.
///
/// Density is the whole of it. A 40-move game across the phone's plot leaves four or five
/// points a ply and the columns want a gap and a rounded cap; a 100-move game leaves under
/// two, where a gap would be moiré. So the gap is given up as the columns narrow and the
/// plot degrades into the solid band it would otherwise have been — the same silhouette,
/// drawn the only way that width allows.
enum EvalBars {
    struct Layout: Equatable {
        let width: CGFloat
        let gap: CGFloat
    }

    static func layout(plotWidth: CGFloat, plies: Int) -> Layout {
        let step = plotWidth / CGFloat(max(1, plies))
        let gap: CGFloat = step >= 4 ? 1.1 : step >= 2.5 ? 0.6 : 0
        return Layout(width: max(0.75, step - gap), gap: gap)
    }
}
