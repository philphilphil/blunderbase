import XCTest
@testable import Blunderbase

/// The one rule in the eval plot: how wide a column is, from how many must fit.
///
/// It is the web's own rule, and the numbers here are the web's test's numbers, so a plot
/// that degrades differently on the phone would show up as a number rather than a feeling.
final class EvalBarsTests: XCTestCase {

    func testAShortGameGetsAGapAndMostOfTheStep() {
        let layout = EvalBars.layout(plotWidth: 360, plies: 40)
        XCTAssertEqual(layout.gap, 1.1)
        XCTAssertEqual(layout.width, 9 - 1.1, accuracy: 0.001)
    }

    func testAMediumGameKeepsAThinnerGap() {
        let layout = EvalBars.layout(plotWidth: 360, plies: 120)
        XCTAssertEqual(layout.gap, 0.6)
        XCTAssertEqual(layout.width, 3 - 0.6, accuracy: 0.001)
    }

    func testALongGameBecomesASolidBand() {
        let layout = EvalBars.layout(plotWidth: 360, plies: 240)
        XCTAssertEqual(layout.gap, 0)
        XCTAssertEqual(layout.width, 1.5, accuracy: 0.001)
    }

    func testAColumnNeverVanishes() {
        XCTAssertEqual(EvalBars.layout(plotWidth: 100, plies: 1000).width, 0.75)
        XCTAssertGreaterThan(EvalBars.layout(plotWidth: 0, plies: 40).width, 0)
    }

    func testAnEmptyGameDoesNotDivideByZero() {
        XCTAssertEqual(EvalBars.layout(plotWidth: 360, plies: 0).width, 360 - 1.1, accuracy: 0.001)
    }
}
