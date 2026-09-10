import Foundation
import Observation

/// What the library holds and how it has been going — the numbers the dashboard draws.
///
/// The phone's version of the web dashboard, and the same calls behind it: `/stats/profile`
/// for the ratings and the size of the library, `/stats/dashboard` for every aggregation
/// over one window the server anchored on the newest game, and `/stats/compare` for the
/// window before it. What the web shows that this does not is the analysis queue and the
/// sync button, both of which act on the server; the phone reads.
///
/// **Two windows, two controls.** The rating charts are cut on the phone, because the
/// profile carries every point and cutting is cheap; the trends are cut on the server,
/// because they are aggregations over games and moves, and each window is a fresh request.
/// So `ratingWindow` changes nothing but a filter, and `trendWindow` asks again.
@Observable
@MainActor
final class DashboardStore {

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    /// How far back the rating charts look. The web's four, in the web's order.
    enum RatingWindow: String, CaseIterable, Identifiable {
        case all
        case year
        case quarter
        case month

        var id: String { rawValue }

        var days: Int? {
            switch self {
            case .all: return nil
            case .year: return 365
            case .quarter: return 90
            case .month: return 30
            }
        }

        var label: String {
            switch self {
            case .all: return String(localized: "All")
            case .year: return String(localized: "1y")
            case .quarter: return String(localized: "90d")
            case .month: return String(localized: "30d")
            }
        }
    }

    /// How far back the trends look — and how far back again the window they are compared
    /// against reaches. The web's three.
    enum TrendWindow: Int, CaseIterable, Identifiable {
        case week = 7
        case month = 30
        case quarter = 90

        var id: Int { rawValue }
        var days: Int { rawValue }

        var label: String {
            switch self {
            case .week: return String(localized: "7d")
            case .month: return String(localized: "30d")
            case .quarter: return String(localized: "90d")
            }
        }
    }

    /// The three numbers of the trends card and how each moved against the window before.
    struct Trends: Equatable {
        let window: TrendWindow
        /// Games in the window.
        let games: Int
        /// Where the window ends — the newest game, or now.
        let until: Date?
        let blundersPerGame: Double?
        let winLossPerMove: Double?
        /// The score as a percentage, 0…100.
        let score: Double?
        let blundersDelta: Double?
        let winLossDelta: Double?
        let scoreDelta: Double?
    }

    private(set) var state: LoadState = .idle
    private(set) var profile: ProfileResponse?
    /// Every aggregation over the whole library, for the line under the title.
    private(set) var allTime: StatsDashboardResponse?
    private(set) var trends: Trends?
    private(set) var trendsState: LoadState = .idle

    /// A year to start with: long enough to show a shape, short enough that a decade of
    /// games does not flatten this season into a line along the middle.
    var ratingWindow: RatingWindow = .year

    /// The speeds whose charts are switched off. Read from the phone's settings once and
    /// written back on every flip, so the choice survives a relaunch.
    private(set) var hiddenSpeeds: Set<String> = Preferences.hiddenRatingSpeeds

    func toggleSpeed(_ speed: String) {
        if hiddenSpeeds.contains(speed) {
            hiddenSpeeds.remove(speed)
        } else {
            hiddenSpeeds.insert(speed)
        }
        Preferences.hiddenRatingSpeeds = hiddenSpeeds
    }

    var trendWindow: TrendWindow = .month {
        didSet {
            guard trendWindow != oldValue else { return }
            Task { await loadTrends() }
        }
    }

    @ObservationIgnored private var endpoints: Endpoints?
    @ObservationIgnored private weak var session: Session?

    func attach(endpoints: Endpoints, session: Session?) {
        self.session = session
        guard self.endpoints == nil else { return }
        self.endpoints = endpoints
    }

    // MARK: Loading

    func load() async {
        guard let endpoints, state != .loading else { return }
        state = .loading
        do {
            async let profile = endpoints.profile()
            async let allTime = endpoints.dashboard()
            let answers = try await (profile, allTime)
            self.profile = answers.0
            self.allTime = answers.1
            state = .loaded
        } catch {
            session?.handle(error)
            state = .failed((error as? LocalizedError)?.errorDescription ?? "\(error)")
        }
        await loadTrends()
    }

    /// Pull-to-refresh: what is on screen stays until the new numbers land.
    func refresh() async {
        guard let endpoints else { return }
        do {
            async let profile = endpoints.profile()
            async let allTime = endpoints.dashboard()
            let answers = try await (profile, allTime)
            self.profile = answers.0
            self.allTime = answers.1
            state = .loaded
        } catch {
            session?.handle(error)
            if profile == nil {
                state = .failed((error as? LocalizedError)?.errorDescription ?? "\(error)")
            }
        }
        await loadTrends()
    }

    /// The trends for the chosen window, and the same numbers for the window before it.
    ///
    /// Three requests, in two steps: the window's own aggregations first, because they
    /// carry the dates the server anchored the window on, and the two comparisons after,
    /// against the same-length window that ended where this one starts. The web asks the
    /// same way (`useCompare` in `routes/stats/kit/analytics.ts`), so both screens compare
    /// the same two spans.
    func loadTrends() async {
        guard let endpoints else { return }
        let window = trendWindow
        trendsState = .loading
        do {
            let now = try await endpoints.dashboard(days: window.days)
            var performanceDelta: StatsBucket?
            var phaseDelta: StatsBucket?
            if let since = now.since, let until = now.until, until > since {
                let then = since.addingTimeInterval(-(until.timeIntervalSince(since)))...since
                async let performance = endpoints.compare(
                    dimension: "performance_by_speed", then: then, now: since...until
                )
                async let phase = endpoints.compare(
                    dimension: "blunders_by_phase", then: then, now: since...until
                )
                let comparisons = try await (performance, phase)
                performanceDelta = comparisons.0.delta?.total
                phaseDelta = comparisons.1.delta?.total
            }
            // The reader may have moved the control while this was in flight; the answer
            // to an older question is not drawn over the newer one.
            guard window == trendWindow else { return }
            trends = DashboardStore.trends(
                window: window, now: now, performanceDelta: performanceDelta, phaseDelta: phaseDelta
            )
            trendsState = .loaded
        } catch {
            session?.handle(error)
            guard window == trendWindow else { return }
            trendsState = .failed((error as? LocalizedError)?.errorDescription ?? "\(error)")
        }
    }

    /// Take answers that have already been fetched — a preview and a test both want the
    /// screen without a server to fake.
    func adopt(profile: ProfileResponse, allTime: StatsDashboardResponse, trends: Trends? = nil) {
        self.profile = profile
        self.allTime = allTime
        self.trends = trends
        state = .loaded
        trendsState = trends == nil ? .idle : .loaded
    }

    // MARK: Reading the numbers

    /// The trends card's numbers out of the window's aggregations and the comparison's
    /// deltas — the web's `TrendsCard` reading, field for field.
    static func trends(
        window: TrendWindow,
        now: StatsDashboardResponse,
        performanceDelta: StatsBucket?,
        phaseDelta: StatsBucket?
    ) -> Trends {
        let performance = now.dimensions["performance_by_speed"]?.total
        let phase = now.dimensions["blunders_by_phase"]?.total
        return Trends(
            window: window,
            games: Int(performance?.number("games") ?? 0),
            until: now.until ?? now.anchor,
            blundersPerGame: performance?.number("blunders_per_game"),
            winLossPerMove: phase?.number("avg_win_loss"),
            score: performance?.number("score").map { $0 * 100 },
            blundersDelta: performanceDelta?.number("blunders_per_game"),
            winLossDelta: phaseDelta?.number("avg_win_loss"),
            scoreDelta: performanceDelta?.number("score").map { $0 * 100 }
        )
    }

    /// How many games the library holds.
    var games: Int { profile?.volume.games ?? 0 }

    /// How many blunders the engine has found in them, over every game.
    var blunders: Int? {
        allTime?.dimensions["blunders_by_phase"]?.total?.number("blunder").map { Int($0) }
    }

    /// Every rating chart the window allows, hidden ones included — what the speeds menu
    /// lists, so a hidden speed stays reachable to bring back.
    var allRatingCharts: [RatingCharts.SpeedChart] {
        RatingCharts.build(profile?.ratings ?? [], days: ratingWindow.days)
    }

    /// The rating charts on screen: one per speed the reader has not switched off, one
    /// line per platform.
    var ratingCharts: [RatingCharts.SpeedChart] {
        allRatingCharts.filter { !hiddenSpeeds.contains($0.speed) }
    }

    /// The platforms with a line on any chart on screen, in their fixed order — the legend.
    var ratingPlatforms: [String] {
        let present = Set(ratingCharts.flatMap { $0.lines.map(\.platform) })
        return RatingCharts.platforms.filter(present.contains)
    }
}

/// The rating series grouped into one chart per speed, each carrying one line per platform.
///
/// The grouping is the web's (`RatingCard.buildCharts`): overlaying blitz on classical says
/// nothing — the scales are different populations — while overlaying Lichess blitz on
/// Chess.com blitz is exactly the comparison worth having. So the speeds are stacked as
/// separate charts and the platforms share each chart's axes.
///
/// The window is anchored on the newest rated game across every series rather than on
/// today, so a library last synced in March is cut at March and every chart is cut at the
/// same instant.
enum RatingCharts {

    /// Drawn in this order, so a platform's colour never moves between charts.
    static let platforms = ["lichess", "chesscom", "fics", "otb"]

    struct Line: Equatable, Identifiable {
        let platform: String
        /// Inside the window, oldest first. One is a dot, two or more are a line.
        let points: [RatingPoint]
        /// The last rating in the window.
        let last: Int
        /// The move across the window, or nil with nothing to compare against.
        let move: Int?

        var id: String { platform }
    }

    struct SpeedChart: Equatable, Identifiable {
        let speed: String
        /// Rated games behind the chart, which is how the charts are ordered.
        let games: Int
        let lines: [Line]

        var id: String { speed }
    }

    /// The newest rated game anywhere, which is where every window ends.
    static func anchor(_ series: [RatingSeries]) -> Date? {
        series.flatMap(\.points).map(\.at).max()
    }

    static func build(_ series: [RatingSeries], days: Int?) -> [SpeedChart] {
        let cutoff: Date? = days.flatMap { days in
            anchor(series).map { $0.addingTimeInterval(-Double(days) * 86_400) }
        }
        var bySpeed: [String: [RatingSeries]] = [:]
        for one in series where !one.points.isEmpty {
            bySpeed[one.speed ?? "unknown", default: []].append(one)
        }

        var charts: [SpeedChart] = []
        for (speed, group) in bySpeed {
            var lines: [Line] = []
            var games = 0
            for platform in platforms {
                let points = group
                    .filter { $0.platform == platform }
                    .flatMap(\.points)
                    .filter { cutoff == nil || $0.at >= cutoff! }
                    .sorted { $0.at < $1.at }
                guard let first = points.first, let last = points.last else { continue }
                games += points.count
                lines.append(Line(
                    platform: platform,
                    points: points,
                    last: last.rating,
                    move: points.count > 1 ? last.rating - first.rating : nil
                ))
            }
            // A speed with fewer than two points has no shape to read.
            guard games >= 2 else { continue }
            charts.append(SpeedChart(speed: speed, games: games, lines: lines))
        }
        // Most-played first, and by name on a tie so the order does not shuffle between
        // renders of the same data.
        return charts.sorted { ($0.games, $1.speed) > ($1.games, $0.speed) }
    }
}
