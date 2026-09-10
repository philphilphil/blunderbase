import XCTest
@testable import Blunderbase

/// The debug launch arguments, which are how a screen is opened without tapping to it.
///
/// The parser is small and the app cannot report on it — a wrong reading is a screen that
/// quietly opens somewhere else — so the cases worth pinning are the ones that make the
/// difference between opening on the game you asked for and opening on the dashboard: a
/// missing value, a value that is not a number, and the arguments the simulator adds by
/// itself, which must not stop the ones that were meant.
final class LaunchStateTests: XCTestCase {

    func testNoArgumentsIsTheAppAsItIs() {
        let launch = LaunchState(arguments: ["/path/Blunderbase.app/Blunderbase"])
        XCTAssertEqual(launch, LaunchState())
        XCTAssertNil(launch.tab)
        XCTAssertNil(launch.gameID)
    }

    func testEachTabFlagNamesItsTab() {
        let expected: [String: RootTab] = [
            "--dashboard": .dashboard,
            "--games": .games,
            "--explorer": .explorer,
            "--notes": .notes,
            "--settings": .settings,
        ]
        for (flag, tab) in expected {
            XCTAssertEqual(LaunchState(arguments: ["app", flag]).tab, tab, "\(flag)")
        }
    }

    func testAGameOpensOnTheGamesTab() {
        let launch = LaunchState(arguments: ["app", "--game", "123"])
        XCTAssertEqual(launch.gameID, 123)
        XCTAssertEqual(launch.tab, .games, "the back button out of a game has to land on the library")
    }

    func testAGameThatIsNotANumberIsNotAGame() {
        let launch = LaunchState(arguments: ["app", "--game", "seventeen"])
        XCTAssertNil(launch.gameID)
        XCTAssertNil(launch.tab)
    }

    func testAFlagDoesNotSwallowTheFlagAfterIt() {
        let launch = LaunchState(arguments: ["app", "--server", "--games"])
        XCTAssertNil(launch.server)
        XCTAssertEqual(launch.tab, .games)
    }

    func testTheServerAndPasswordAreTakenAsTyped() {
        let launch = LaunchState(arguments: [
            "app", "--server", "http://localhost:8765", "--password", "hunter2", "--notes",
        ])
        XCTAssertEqual(launch.server, "http://localhost:8765")
        XCTAssertEqual(launch.password, "hunter2")
        XCTAssertEqual(launch.tab, .notes)
    }

    /// XCTest and the simulator both put words on the command line. None of them may stop a
    /// flag that follows, which is the whole reason unknown arguments are skipped instead of
    /// ending the parse.
    func testArgumentsTheAppDidNotAskForAreIgnored() {
        let launch = LaunchState(arguments: [
            "app", "-XCTest", "All", "-ApplePersistenceIgnoreState", "YES", "--explorer",
        ])
        XCTAssertEqual(launch.tab, .explorer)
        XCTAssertNil(launch.gameID)
    }
}
