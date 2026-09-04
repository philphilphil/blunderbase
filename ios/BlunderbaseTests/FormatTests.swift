import XCTest
@testable import Blunderbase

/// The formatters are shared by every screen, and two of them encode a convention that is
/// easy to get subtly wrong — the clock in minutes rather than the stored seconds, and the
/// win loss written negative. These tests pin the conventions, not the strings.
final class FormatTests: XCTestCase {

    // MARK: Dates

    func testDateOmitsTheYearInsideTheCurrentOne() {
        let now = date(2026, 9, 3)
        XCTAssertEqual(Format.date(date(2026, 8, 22), now: now), "22 Aug")
    }

    func testDateShowsTheYearOutsideTheCurrentOne() {
        let now = date(2026, 9, 3)
        XCTAssertEqual(Format.date(date(2016, 12, 7), now: now), "7 Dec 16")
    }

    func testAbsentDateIsADash() {
        XCTAssertEqual(Format.date(nil), Format.absent)
    }

    // MARK: Result

    func testResultUsesRealTypography() {
        XCTAssertEqual(Format.result("1-0"), "1–0")
        XCTAssertEqual(Format.result("0-1"), "0–1")
        XCTAssertEqual(Format.result("1/2-1/2"), "½–½")
        XCTAssertEqual(Format.result("*"), "*")
        XCTAssertEqual(Format.result(nil), Format.absent)
    }

    func testAnUnknownResultIsPassedThroughRatherThanHidden() {
        XCTAssertEqual(Format.result("2-0"), "2-0")
    }

    // MARK: Time control

    func testTimeControlConvertsStoredSecondsToTheMinutesAPlayerSays() {
        XCTAssertEqual(Format.timeControl("600+0"), "10+0")
        XCTAssertEqual(Format.timeControl("180+2"), "3+2")
        XCTAssertEqual(Format.timeControl("5400+30"), "90+30")
    }

    func testATimeControlThatIsNotAWholeMinuteKeepsItsFraction() {
        XCTAssertEqual(Format.timeControl("90+0"), "1.5+0")
    }

    func testACorrespondenceTimeControlIsNamedRatherThanDividedBySixty() {
        XCTAssertEqual(Format.timeControl("-"), "correspondence")
    }

    func testAnUnparseableTimeControlIsShownAsItArrived() {
        XCTAssertEqual(Format.timeControl("OTB"), "OTB")
        XCTAssertEqual(Format.timeControl(nil), Format.absent)
    }

    // MARK: Clocks

    func testClockIsMinutesAndSecondsUntilItPassesAnHour() {
        XCTAssertEqual(Format.clock(252), "4:12")
        XCTAssertEqual(Format.clock(9), "0:09")
        XCTAssertEqual(Format.clock(3852), "1:04:12")
    }

    func testANegativeOrMissingClockIsADashRatherThanZero() {
        XCTAssertEqual(Format.clock(nil), Format.absent)
        XCTAssertEqual(Format.clock(-1), Format.absent)
    }

    func testTheClockTurnsAmberOnlyInsideTimeTrouble() {
        XCTAssertEqual(Format.clockColor(19), Theme.mistake)
        XCTAssertEqual(Format.clockColor(21), Theme.body2)
    }

    // MARK: Severity

    func testWinLossIsWrittenNegativeBecauseItIsWhatAMoveCost() {
        XCTAssertEqual(Format.winLoss(58), "−58%")
        XCTAssertEqual(Format.winLoss(0), Format.absent)
        XCTAssertEqual(Format.winLoss(nil), Format.absent)
    }

    func testSeverityRampMatchesTheDisplayThresholds() {
        XCTAssertEqual(Format.severityColor(45), Theme.blunder)
        XCTAssertEqual(Format.severityColor(30), Theme.blunder)
        XCTAssertEqual(Format.severityColor(29.9), Theme.mistake)
        XCTAssertEqual(Format.severityColor(15), Theme.mistake)
        XCTAssertEqual(Format.severityColor(14), Theme.inaccuracy)
        XCTAssertEqual(Format.severityColor(7), Theme.inaccuracy)
        XCTAssertEqual(Format.severityColor(6), Theme.dim)
    }

    // MARK: Score

    func testScoreIsWrittenTheWayAPlayerSaysIt() {
        XCTAssertEqual(Format.score(cp: 140, mate: nil), "+1.4")
        XCTAssertEqual(Format.score(cp: -60, mate: nil), "−0.6")
        XCTAssertEqual(Format.score(cp: 0, mate: nil), "0.0")
    }

    func testMateDropsTheDecimalBecauseItIsNotAPawnCount() {
        XCTAssertEqual(Format.score(cp: nil, mate: 3), "M3")
        XCTAssertEqual(Format.score(cp: nil, mate: -2), "−M2")
    }

    func testMateWinsOverCentipawnsWhenBothArrive() {
        XCTAssertEqual(Format.score(cp: 900, mate: 4), "M4")
    }

    func testNoEvaluationIsNilRatherThanADashSoACallerCanDecide() {
        XCTAssertNil(Format.score(cp: nil, mate: nil))
    }

    // MARK: The owner's own results

    /// The shares are over the games that were scored, not over `games` — a position the
    /// owner reached fourteen times but has only eleven results for still draws a full bar.
    func testTheSplitDividesByTheGamesThatWereScored() {
        let split = Format.split(wins: 8, draws: 2, losses: 4, games: 14)
        XCTAssertEqual(split.games, 14)
        XCTAssertEqual(split.winPercent + split.drawPercent + split.lossPercent, 100, accuracy: 0.001)
        XCTAssertEqual(split.winPercent, 100 * 8 / 14, accuracy: 0.001)

        let partial = Format.split(wins: 4, draws: 1, losses: 1, games: 9)
        XCTAssertEqual(partial.games, 9, "the count of games is reported as sent")
        XCTAssertEqual(partial.winPercent, 100 * 4 / 6, accuracy: 0.001, "but the bar fills")
    }

    func testASplitWithoutCountsIsEmptyRatherThanADivisionByZero() {
        let split = Format.split(wins: nil, draws: nil, losses: nil)
        XCTAssertEqual(split.games, 0)
        XCTAssertEqual(split.winPercent, 0)
        XCTAssertEqual(split.lossPercent, 0)
    }

    /// One decimal, the explorer's own rounding: the same position must not read 64% here
    /// and 64.3% in the browser.
    func testScorePercentRoundsTheWayTheExplorerDoes() {
        XCTAssertEqual(Format.scorePercent(0.5192), "51.9%")
        XCTAssertEqual(Format.scorePercent(0.6428571), "64.3%")
        XCTAssertEqual(Format.scorePercent(0.5), "50.0%")
        XCTAssertEqual(Format.scorePercent(nil), Format.absent)
    }

    func testAverageDropIsWrittenNegativeAndToOneDecimal() {
        XCTAssertEqual(Format.avgDrop(4.23), "−4.2%")
        XCTAssertEqual(Format.avgDrop(0), "0.0%")
        XCTAssertEqual(Format.avgDrop(nil), Format.absent, "unevaluated is not a drop of nothing")
    }

    // MARK: Moves

    /// Plies come off the wire numbered from zero, so ply 0 is White's first move and an
    /// even ply is always White's. Reading them as 1-based mislabels every move as its
    /// neighbour — right number, wrong side, or a move number out by one.
    func testMoveNumberSaysWhichSideMovedWithoutAColumnForIt() {
        XCTAssertEqual(Format.moveNumber(ply: 0), "1.")
        XCTAssertEqual(Format.moveNumber(ply: 1), "1…")
        XCTAssertEqual(Format.moveNumber(ply: 34), "18.")
        XCTAssertEqual(Format.moveNumber(ply: 35), "18…")
    }

    func testMoveQuotesThePlyAndTheSanTogether() {
        XCTAssertEqual(Format.move(ply: 34, san: "Bxf6"), "18. Bxf6")
        XCTAssertEqual(Format.move(ply: 35, san: "gxf6"), "18… gxf6")
    }

    func testAMoveWithoutSanStillNamesItsPly() {
        XCTAssertEqual(Format.move(ply: 34, san: nil), "18.")
    }

    /// A note's ply is a half-move *count* — the position after the move — so naming its
    /// move means stepping back one. The proof is the backend's own label: a note at count
    /// 24 comes back spelled `12... Nxe5`, and this has to agree with it.
    func testANoteCountNamesTheMoveBeforeItAndAgreesWithTheServersLabel() {
        XCTAssertEqual(Format.move(ply: 24 - 1, san: "Nxe5"), "12… Nxe5")
        XCTAssertEqual(Format.move(ply: 1 - 1, san: "e4"), "1. e4")
    }

    func testMoveCountIsWholeMovesNotHalfOnes() {
        XCTAssertEqual(Format.moveCount(plyCount: 91), "46")
        XCTAssertEqual(Format.moveCount(plyCount: 90), "45")
        XCTAssertEqual(Format.moveCount(plyCount: nil), Format.absent)
    }

    // MARK: Helpers

    private func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        return Calendar.current.date(from: components) ?? Date()
    }
}

/// The engine throughput formatters, which are read while they change rather than for their
/// value, so the only thing that matters is that the magnitude is never wrong.
extension FormatTests {

    func testNodesPerSecondAbbreviatesRatherThanGroups() {
        XCTAssertEqual(Format.nodesPerSecond(1_234_567), "1.2M/s")
        XCTAssertEqual(Format.nodesPerSecond(840_000), "840k/s")
        XCTAssertEqual(Format.nodesPerSecond(512), "512/s")
    }

    func testNodesUsesTheSameScale() {
        XCTAssertEqual(Format.nodes(4_700_000), "4.7M")
        XCTAssertEqual(Format.nodes(312_000), "312k")
        XCTAssertEqual(Format.nodes(2_100_000_000), "2.1B")
    }

    func testAnAbsentOrZeroThroughputIsADashRatherThanZero() {
        XCTAssertEqual(Format.nodesPerSecond(nil), Format.absent)
        XCTAssertEqual(Format.nodesPerSecond(0), Format.absent)
        XCTAssertEqual(Format.nodes(nil), Format.absent)
    }
}
