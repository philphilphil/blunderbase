import SwiftUI
import Charts

/// The first screen: what the library holds, what has gone wrong lately, and how it is
/// going.
///
/// The web dashboard's sections, in the web's order, minus the two that act on the server:
/// the line under the title, the rating charts, the worst moments, the trends. The sync
/// button and the analysis queue stay in the browser, where a tap can do something about
/// them; the recent games are the Games tab, one swipe away.
///
/// The worst moments used to sit at the top of the games list, because the phone had no
/// dashboard to put them on. It has one now, and the list is the list again — a table with
/// filters and nothing above it that is an answer to a different question.
struct DashboardView: View {
    @Environment(Session.self) private var session
    @State private var store = DashboardStore()
    /// The six worst moments of the last month — their own store, because they are one
    /// unfiltered call that fails on its own. See `MomentsStore`.
    @State private var moments = MomentsStore()
    /// Whether the engine may speak: the worst moments and the blunder counts are its
    /// verdicts. The ratings are not — they are the games' own.
    @AppStorage(Preferences.Key.engineHidden) private var engineHidden = false

    init() {}

    /// The same screen over stores that already have their answers — how a preview or a
    /// snapshot gets numbers on it without a server to ask.
    init(store: DashboardStore, moments: MomentsStore) {
        _store = State(initialValue: store)
        _moments = State(initialValue: moments)
    }

    var body: some View {
        NavigationStack {
            content
                .background(Theme.void)
                .navigationTitle("Dashboard")
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        EngineVisibilityButton(engineHidden: $engineHidden)
                    }
                }
        }
        .task {
            guard let endpoints = session.endpoints else { return }
            store.attach(endpoints: endpoints, session: session)
            moments.attach(endpoints: endpoints, session: session)
            if store.state == .idle { await store.load() }
            if moments.state == .idle { await moments.load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.state {
        case .idle, .loading:
            ProgressView()
                .tint(Theme.accent)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            Placeholder(
                symbol: "exclamationmark.triangle",
                tint: Theme.mistake,
                title: message,
                detail: nil,
                actionTitle: String(localized: "Try again")
            ) {
                Task { await store.load() }
            }
        case .loaded:
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    subtitle
                    trends
                    ratings
                    worstMoments
                }
                .padding(.bottom, 24)
            }
            .refreshable {
                async let numbers: Void = store.refresh()
                async let recent: Void = moments.refresh()
                _ = await (numbers, recent)
            }
        }
    }

    // MARK: The line under the title

    /// `4,200 games · 11,060 blunders` — the web's subtitle sentence, as the numbers line
    /// every tab has under its title. The blunders are the engine's count and go with it.
    @ViewBuilder
    private var subtitle: some View {
        if store.games == 0 {
            Text("Nothing imported yet. Start with a sync or a PGN in the web app.")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
                .padding(.horizontal, Theme.Metrics.gutter)
                .padding(.vertical, 10)
        } else if !engineHidden, let blunders = store.blunders {
            TitleLine(
                Text("\(Format.count(store.games)) games")
                    + Text(verbatim: " · ")
                    + Text("\(Format.count(blunders)) blunders")
            )
        } else {
            TitleLine(Text("\(Format.count(store.games)) games"))
        }
    }

    // MARK: Ratings

    /// One chart per speed, one line per platform inside it, all cut at the same instant
    /// by the window control. Only rated games are plotted, so an OTB-only library with no
    /// ratings shows the sentence rather than an empty box. The speeds menu switches
    /// charts off — it lists every speed the window has, hidden ones included, so a hidden
    /// one stays reachable — and the legend says which colour is which site, once, above
    /// the charts rather than on each of them.
    @ViewBuilder
    private var ratings: some View {
        SectionHead("Ratings") {
            speedsMenu
        }

        let all = store.allRatingCharts
        let charts = store.ratingCharts
        if all.isEmpty {
            Text("No rated games in this window.")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
                .padding(.horizontal, Theme.Metrics.gutter)
                .padding(.bottom, 8)
        } else if charts.isEmpty {
            Text("Every speed is hidden. Pick one in the speeds menu.")
                .font(Theme.Font.text(13))
                .foregroundStyle(Theme.dim)
                .padding(.horizontal, Theme.Metrics.gutter)
                .padding(.bottom, 8)
        } else {
            legend
            VStack(spacing: 4) {
                ForEach(charts) { chart in
                    ratingChart(chart)
                }
            }
        }
    }

    /// Which speeds to draw. Every speed the window has, with a tick on the ones showing,
    /// so a chart switched off can be switched back on from the same place.
    private var speedsMenu: some View {
        Menu {
            ForEach(store.allRatingCharts) { chart in
                Button {
                    store.toggleSpeed(chart.speed)
                    Haptics.selectionChanged()
                } label: {
                    if store.hiddenSpeeds.contains(chart.speed) {
                        Text(Speed(rawValue: chart.speed).label)
                    } else {
                        Label(Speed(rawValue: chart.speed).label, systemImage: "checkmark")
                    }
                }
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .font(.system(size: 15))
                .foregroundStyle(store.hiddenSpeeds.isEmpty ? Theme.dim : Theme.accent)
                .frame(width: 26, height: 22)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("Speeds")
    }

    /// Which colour is which site, said once for all the charts below.
    private var legend: some View {
        HStack(spacing: 12) {
            ForEach(store.ratingPlatforms, id: \.self) { platform in
                HStack(spacing: 4) {
                    Circle()
                        .fill(DashboardView.platformColor(platform))
                        .frame(width: 7, height: 7)
                    Text(DashboardView.platformName(platform))
                        .font(Theme.Font.text(11))
                        .foregroundStyle(Theme.dim)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.top, 8)
        .padding(.bottom, 2)
    }

    /// One speed: its name and its numbers on a line over a hairline, the chart under it.
    ///
    /// It was a bordered card per speed. Three cards in a column with the same border and
    /// the same radius were the template's look, not the app's; a sub-heading over a rule is
    /// how the web's Ratings section draws the same thing, and the rule plus the gap is
    /// enough to keep two charts from reading as one chart with a kink in it.
    private func ratingChart(_ chart: RatingCharts.SpeedChart) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Speed(rawValue: chart.speed).label)
                    .font(Theme.Font.text(14, weight: .semibold))
                    .foregroundStyle(Theme.text)
                Spacer(minLength: 4)
                ForEach(chart.lines) { line in
                    legendEntry(line)
                }
            }
            .padding(.horizontal, Theme.Metrics.gutter)
            .padding(.bottom, 4)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Theme.hairline).frame(height: 0.5)
                    .padding(.horizontal, Theme.Metrics.gutter)
            }

            Chart {
                ForEach(chart.lines) { line in
                    marks(line)
                }
            }
            .chartYScale(domain: .automatic(includesZero: false))
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { _ in
                    AxisGridLine().foregroundStyle(Theme.graphGrid)
                    // A rating is an identifier, not a quantity: `1712`, never `1,712`.
                    AxisValueLabel(format: DashboardView.ratingFormat)
                        .font(Theme.Font.mono(9))
                        .foregroundStyle(Theme.graphTick)
                }
            }
            .chartXAxis {
                // The chart picks the date form for the span it is showing — days across
                // a month, months across a year — rather than one form repeating itself.
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    AxisValueLabel()
                        .font(Theme.Font.mono(9))
                        .foregroundStyle(Theme.graphTick)
                }
            }
            .frame(height: 110)
            .padding(.horizontal, Theme.Metrics.gutter)
        }
        .padding(.top, 12)
        .padding(.bottom, 6)
        .accessibilityElement(children: .combine)
    }

    private static let ratingFormat = IntegerFormatStyle<Int>().grouping(.never)

    /// One platform's line — or its dot, when the window holds a single game, which is a
    /// point rather than nothing. Its own builder so the chart's body stays something the
    /// type-checker finishes.
    @ChartContentBuilder
    private func marks(_ line: RatingCharts.Line) -> some ChartContent {
        let color = DashboardView.platformColor(line.platform)
        ForEach(line.points) { point in
            LineMark(
                x: .value("Date", point.at),
                y: .value("Rating", point.rating),
                series: .value("Platform", line.platform)
            )
            .foregroundStyle(color)
            .lineStyle(StrokeStyle(lineWidth: 1.5))
            .interpolationMethod(.monotone)
        }
        // The last point is the rating now, which is the number in the line's legend; a
        // dot on it is what ties the number to the place on the curve it came from. A
        // window with a single game is a point rather than nothing, and gets the same dot.
        if let last = line.points.last {
            PointMark(x: .value("Date", last.at), y: .value("Rating", last.rating))
                .foregroundStyle(color)
                .symbolSize(22)
        }
    }

    /// A swatch, the last rating, and how far it moved across the window.
    private func legendEntry(_ line: RatingCharts.Line) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(DashboardView.platformColor(line.platform))
                .frame(width: 7, height: 7)
            Text(verbatim: "\(line.last)")
                .font(Theme.Font.mono(12, weight: .medium))
                .foregroundStyle(Theme.body)
            if let move = line.move {
                Text(DashboardView.signed(Double(move), digits: 0))
                    .font(Theme.Font.mono(10))
                    .foregroundStyle(move > 0 ? Theme.good : move < 0 ? Theme.blunder : Theme.faint)
            }
        }
        .accessibilityLabel(
            "\(DashboardView.platformName(line.platform)) \(line.last)"
        )
    }

    /// The web's chart colours per platform (`RatingCard.PLATFORM_COLOR`), so a Lichess
    /// line is the same blue in both places.
    static func platformColor(_ platform: String) -> Color {
        switch platform {
        case "lichess": return Theme.accent
        case "chesscom": return Theme.brilliant
        case "fics": return Theme.mistake
        case "otb": return Theme.info
        default: return Theme.dim
        }
    }

    static func platformName(_ platform: String) -> String {
        switch platform {
        case "lichess": return "Lichess"
        case "chesscom": return "Chess.com"
        case "fics": return "FICS"
        case "otb": return "OTB"
        default: return platform
        }
    }

    // MARK: Worst moments

    @ViewBuilder
    private var worstMoments: some View {
        if let endpoints = session.endpoints, moments.isVisible(engineHidden: engineHidden) {
            WorstMomentsStrip(store: moments, endpoints: endpoints)
                .padding(.top, 8)
        }
    }

    // MARK: Trends

    /// Blunders per game, the win percentage an average move gives away, and the score,
    /// each against the equally long window before this one. First on the screen, because
    /// it is the question the screen exists to answer, and its head carries the one window
    /// control the whole screen has — the rating charts below follow it. The first two are
    /// the engine's numbers and go with it; the score stays.
    @ViewBuilder
    private var trends: some View {
        SectionHead(text: Text(store.window.title)) {
            TextSegments(
                options: DashboardStore.Window.allCases,
                label: \.label,
                selection: Binding(get: { store.window }, set: { store.window = $0 })
            )
            .accessibilityLabel("Window")
        }

        switch store.trendsState {
        case .idle, .loading:
            if let trends = store.trends {
                trendsBody(trends).opacity(0.5)
            } else {
                ProgressView()
                    .tint(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .font(Theme.Font.text(13))
                    .foregroundStyle(Theme.mistake)
                Button("Try again") {
                    Task { await store.loadTrends() }
                }
                .font(Theme.Font.text(13, weight: .medium))
                .foregroundStyle(Theme.accent)
            }
            .padding(.horizontal, Theme.Metrics.gutter)
        case .loaded:
            if let trends = store.trends {
                trendsBody(trends)
            }
        }
    }

    private func trendsBody(_ trends: DashboardStore.Trends) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Spacer().frame(height: 4)
            HStack(alignment: .top, spacing: 0) {
                if !engineHidden {
                    metric(
                        String(localized: "Blunders per game"),
                        value: trends.blundersPerGame.map { String(format: "%.1f", $0) },
                        delta: trends.blundersDelta,
                        lowerIsBetter: true,
                        digits: 1
                    )
                    metric(
                        String(localized: "Win % given away"),
                        value: trends.winLossPerMove.map { String(format: "%.1f", $0) },
                        delta: trends.winLossDelta,
                        lowerIsBetter: true,
                        digits: 1
                    )
                }
                metric(
                    String(localized: "Score"),
                    value: trends.score.map { String(format: "%.0f%%", $0) },
                    delta: trends.scoreDelta,
                    lowerIsBetter: false,
                    digits: 1
                )
            }

            HStack(spacing: 4) {
                Text("\(trends.games) games")
                Text(verbatim: "·")
                if let until = trends.until, !Calendar.current.isDateInToday(until) {
                    Text("to \(Format.date(until))")
                } else {
                    Text("to today")
                }
            }
            .font(Theme.Font.mono(10))
            .foregroundStyle(Theme.faint)

            if !engineHidden, let sentence = DashboardView.sentence(trends) {
                Text(sentence)
                    .font(Theme.Font.text(12))
                    .foregroundStyle(Theme.dim)
            }
        }
        .padding(.horizontal, Theme.Metrics.gutter)
        .padding(.bottom, 8)
    }

    /// One number and how it moved. The tone is about whether the move is good news, which
    /// depends on the number: fewer blunders is green, fewer points is red.
    private func metric(_ label: String, value: String?, delta: Double?, lowerIsBetter: Bool, digits: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(Theme.Font.text(10))
                .foregroundStyle(Theme.faint)
                .textCase(.uppercase)
                .kerning(0.4)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value ?? Format.absent)
                    .font(Theme.Font.mono(20, weight: .medium))
                    .foregroundStyle(Theme.textBright)
                Text(delta.map { DashboardView.signed($0, digits: digits) } ?? Format.absent)
                    .font(Theme.Font.mono(11))
                    .foregroundStyle(DashboardView.deltaTone(delta, lowerIsBetter: lowerIsBetter))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// `+0.4`, `−1.2`, `±0.0` — with a real minus.
    static func signed(_ value: Double, digits: Int) -> String {
        let rounded = (value * pow(10, Double(digits))).rounded() / pow(10, Double(digits))
        let magnitude = String(format: "%.\(digits)f", abs(rounded))
        if rounded == 0 { return "±\(magnitude)" }
        return rounded > 0 ? "+\(magnitude)" : "−\(magnitude)"
    }

    static func deltaTone(_ delta: Double?, lowerIsBetter: Bool) -> Color {
        guard let delta, delta != 0 else { return Theme.faint }
        let better = lowerIsBetter ? delta < 0 : delta > 0
        return better ? Theme.good : Theme.blunder
    }

    /// The line under the numbers, chosen rather than composed: the reading only makes
    /// sense as a whole sentence, so each of the five is one string a translator sees
    /// entire — the web's `TrendsCard.sentence`.
    static func sentence(_ trends: DashboardStore.Trends) -> String? {
        guard let blunders = trends.blundersDelta, let score = trends.scoreDelta else { return nil }
        if abs(blunders) < 0.05, abs(score) < 1 {
            return String(localized: "Nothing has moved either way. A flat window is still a window.")
        }
        switch (blunders < 0, score > 0) {
        case (true, true):
            return String(localized: "Fewer blunders and more points. Whatever you changed, keep it.")
        case (true, false):
            return String(localized: "Fewer blunders, fewer points. You are losing the game in smaller pieces now.")
        case (false, true):
            return String(localized: "More blunders and more points. You are getting away with it.")
        case (false, false):
            return String(localized: "More blunders and fewer points. The two usually travel together.")
        }
    }
}
