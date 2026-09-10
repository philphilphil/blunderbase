import XCTest
@testable import Blunderbase

/// The dashboard's two pieces of arithmetic: how the rating series become charts, and how
/// the trends card reads its three numbers and their movement out of the stats payloads.
///
/// Both are copies of the web's rules (`RatingCard.buildCharts`, `TrendsCard`), and both are
/// worth a number rather than a look: a chart grouped by the wrong key or a delta read from
/// the wrong dimension draws a perfectly plausible screen about the wrong thing.
@MainActor
final class DashboardTests: XCTestCase {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.makeDecoder().decode(type, from: Data(json.utf8))
    }

    // MARK: Decoding

    func testTheProfileDecodesRatingsAndVolume() throws {
        let profile = try decode(ProfileResponse.self, """
        {"accounts": [], "volume": {"games": 1284, "wins": 600, "draws": 84, "losses": 600, "score": 0.5,
                                    "first_game": "2016-12-07T09:00:00Z", "last_game": "2026-08-22T18:04:00Z",
                                    "by_source": {"lichess": 1284}},
         "ratings": [{"platform": "lichess", "speed": "blitz", "games": 2, "current": 1712, "min": 1690, "max": 1712,
                      "points": [{"at": "2026-08-01T10:00:00Z", "rating": 1690, "game_id": 1},
                                 {"at": "2026-08-22T18:04:00Z", "rating": 1712, "game_id": 2}]}]}
        """)
        XCTAssertEqual(profile.volume.games, 1284)
        XCTAssertEqual(profile.ratings.first?.platform, "lichess")
        XCTAssertEqual(profile.ratings.first?.points.map(\.rating), [1690, 1712])
    }

    /// A bucket keeps whatever numbers the dimension sent, by name, and nothing else.
    func testAStatsBucketKeepsItsNumbersByName() throws {
        let dashboard = try decode(StatsDashboardResponse.self, """
        {"anchor": "2026-08-22T18:04:00Z", "since": "2026-07-23T18:04:00Z", "until": "2026-08-22T18:04:00Z",
         "dimensions": {
           "performance_by_speed": {"dimension": "performance_by_speed",
             "buckets": [{"key": "blitz", "games": 40, "score": 0.55}],
             "total": {"key": "total", "games": 40, "blunders_per_game": 1.6, "score": 0.55, "label": "all"}},
           "blunders_by_phase": {"dimension": "blunders_by_phase",
             "total": {"key": "total", "blunder": 64, "mistake": 90, "avg_win_loss": 3.2}}}}
        """)
        let performance = try XCTUnwrap(dashboard.dimensions["performance_by_speed"]?.total)
        XCTAssertEqual(performance.key, "total")
        XCTAssertEqual(performance.number("blunders_per_game"), 1.6)
        XCTAssertNil(performance.number("label"), "a word is not a number")
        XCTAssertNil(performance.number("avg_win_loss"), "another dimension's field")
        XCTAssertEqual(dashboard.dimensions["blunders_by_phase"]?.total?.number("blunder"), 64)
    }

    // MARK: The trends card

    func testTheTrendsReadEachNumberFromItsOwnDimension() throws {
        let now = try decode(StatsDashboardResponse.self, """
        {"anchor": "2026-08-22T18:04:00Z", "since": "2026-07-23T18:04:00Z", "until": "2026-08-22T18:04:00Z",
         "dimensions": {
           "performance_by_speed": {"total": {"key": "total", "games": 40, "blunders_per_game": 1.6, "score": 0.55}},
           "blunders_by_phase": {"total": {"key": "total", "blunder": 64, "avg_win_loss": 3.2}}}}
        """)
        let trends = DashboardStore.trends(
            window: .month,
            now: now,
            performanceDelta: StatsBucket(numbers: ["blunders_per_game": -0.4, "score": 0.03]),
            phaseDelta: StatsBucket(numbers: ["avg_win_loss": -0.5])
        )
        XCTAssertEqual(trends.games, 40)
        XCTAssertEqual(trends.blundersPerGame, 1.6)
        XCTAssertEqual(trends.winLossPerMove, 3.2)
        XCTAssertEqual(try XCTUnwrap(trends.score), 55, accuracy: 0.001, "the score is a percentage on screen")
        XCTAssertEqual(trends.blundersDelta, -0.4)
        XCTAssertEqual(trends.winLossDelta, -0.5)
        XCTAssertEqual(try XCTUnwrap(trends.scoreDelta), 3, accuracy: 0.001)
    }

    func testTheSentenceIsChosenByWhichWayTheTwoNumbersMoved() {
        func trends(blunders: Double?, score: Double?) -> DashboardStore.Trends {
            DashboardStore.Trends(
                window: .month, games: 10, until: nil,
                blundersPerGame: 1, winLossPerMove: 1, score: 50,
                blundersDelta: blunders, winLossDelta: nil, scoreDelta: score
            )
        }
        XCTAssertNil(DashboardView.sentence(trends(blunders: nil, score: 2)), "nothing to compare against")
        XCTAssertEqual(
            DashboardView.sentence(trends(blunders: 0.01, score: 0.5)),
            "Nothing has moved either way. A flat window is still a window."
        )
        XCTAssertEqual(
            DashboardView.sentence(trends(blunders: -0.4, score: 3)),
            "Fewer blunders and more points. Whatever you changed, keep it."
        )
        XCTAssertEqual(
            DashboardView.sentence(trends(blunders: 0.4, score: -3)),
            "More blunders and fewer points. The two usually travel together."
        )
    }

    func testADeltaIsWrittenWithItsSignAndARealMinus() {
        XCTAssertEqual(DashboardView.signed(0.4, digits: 1), "+0.4")
        XCTAssertEqual(DashboardView.signed(-1.25, digits: 1), "−1.3", "half rounds away from zero, as toFixed does")
        XCTAssertEqual(DashboardView.signed(0.01, digits: 1), "±0.0")
        XCTAssertEqual(DashboardView.signed(-12, digits: 0), "−12")
    }

    // MARK: The rating charts

    private func series(_ platform: String, _ speed: String, _ points: [(String, Int)]) throws -> RatingSeries {
        let json = points.map { #"{"at": "\#($0.0)", "rating": \#($0.1)}"# }.joined(separator: ",")
        return try decode(RatingSeries.self, #"{"platform": "\#(platform)", "speed": "\#(speed)", "games": \#(points.count), "points": [\#(json)]}"#)
    }

    func testChartsAreOneSpeedEachWithALinePerPlatform() throws {
        let charts = RatingCharts.build([
            try series("lichess", "blitz", [("2026-01-01T00:00:00Z", 1600), ("2026-02-01T00:00:00Z", 1650)]),
            try series("chesscom", "blitz", [("2026-01-15T00:00:00Z", 1500)]),
            try series("lichess", "rapid", [
                ("2026-01-01T00:00:00Z", 1700), ("2026-03-01T00:00:00Z", 1690),
                ("2026-04-01T00:00:00Z", 1710), ("2026-05-01T00:00:00Z", 1720),
            ]),
        ], days: nil)

        XCTAssertEqual(charts.map(\.speed), ["rapid", "blitz"], "ordered by how many games stand behind them")
        let blitz = try XCTUnwrap(charts.last)
        XCTAssertEqual(blitz.lines.map(\.platform), ["lichess", "chesscom"], "platforms in their fixed order")
        XCTAssertEqual(blitz.lines[0].move, 50)
        XCTAssertNil(blitz.lines[1].move, "one game has nothing to move from")
    }

    func testTheWindowIsCutAtTheNewestGameNotAtToday() throws {
        let charts = RatingCharts.build([
            try series("lichess", "blitz", [
                ("2026-01-01T00:00:00Z", 1600), ("2026-02-01T00:00:00Z", 1650), ("2026-02-20T00:00:00Z", 1640),
            ]),
        ], days: 30)
        let line = try XCTUnwrap(charts.first?.lines.first)
        XCTAssertEqual(line.points.map(\.rating), [1650, 1640], "January is outside thirty days of 20 February")
        XCTAssertEqual(line.move, -10)
    }

    func testAYearIsTheWindowToStartWith() {
        XCTAssertEqual(DashboardStore().ratingWindow, .year)
    }

    /// A hidden speed leaves the screen but not the menu, and the choice is the phone's.
    func testAHiddenSpeedStaysInTheMenuAndSurvivesTheStore() throws {
        let previous = Preferences.hiddenRatingSpeeds
        defer { Preferences.hiddenRatingSpeeds = previous }
        Preferences.hiddenRatingSpeeds = []

        let profile = try decode(ProfileResponse.self, """
        {"accounts": [], "volume": {"games": 4},
         "ratings": [{"platform": "lichess", "speed": "blitz", "games": 2,
                      "points": [{"at": "2026-08-01T10:00:00Z", "rating": 1690}, {"at": "2026-08-22T18:04:00Z", "rating": 1712}]},
                     {"platform": "chesscom", "speed": "rapid", "games": 2,
                      "points": [{"at": "2026-08-02T10:00:00Z", "rating": 1500}, {"at": "2026-08-20T18:04:00Z", "rating": 1560}]}]}
        """)
        let allTime = try decode(StatsDashboardResponse.self, #"{"until": "2026-08-22T18:04:00Z", "dimensions": {}}"#)
        let store = DashboardStore()
        store.adopt(profile: profile, allTime: allTime)
        XCTAssertEqual(store.ratingPlatforms, ["lichess", "chesscom"])

        store.toggleSpeed("rapid")
        XCTAssertEqual(store.ratingCharts.map(\.speed), ["blitz"])
        XCTAssertEqual(store.allRatingCharts.map(\.speed).sorted(), ["blitz", "rapid"], "still in the menu")
        XCTAssertEqual(store.ratingPlatforms, ["lichess"], "the legend follows what is on screen")

        let again = DashboardStore()
        XCTAssertEqual(again.hiddenSpeeds, ["rapid"], "written to the phone, read by the next store")
        again.adopt(profile: profile, allTime: allTime)
        again.toggleSpeed("rapid")
        XCTAssertTrue(again.hiddenSpeeds.isEmpty)
    }

    func testASpeedWithOnePointHasNoChart() throws {
        let charts = RatingCharts.build([
            try series("lichess", "bullet", [("2026-01-01T00:00:00Z", 1600)]),
        ], days: nil)
        XCTAssertTrue(charts.isEmpty)
    }
}
