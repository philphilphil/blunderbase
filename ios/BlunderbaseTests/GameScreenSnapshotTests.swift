import XCTest
import SwiftUI
@testable import Blunderbase

/// Renders the game screen to a PNG so a layout can be looked at.
///
/// The game screen is the part of this app that gets argued about, and an argument about a
/// layout is settled by looking at it. Every other test here asserts on a number; this one
/// produces a picture, writes it beside the project, and asserts only the two things a
/// picture can be wrong about mechanically — that it rendered at all, and that it is not a
/// flat field of one colour, which is what a SwiftUI view that failed to lay out produces.
///
/// It is not a golden-image test. There is no reference PNG to diff against and no
/// threshold to tune, because a proof of concept's layout is supposed to change every day
/// and a golden test would just be a chore that fails on every commit. Judging whether it
/// looks right stays a human job; this only guarantees there is something to judge.
@MainActor
final class GameScreenSnapshotTests: XCTestCase {

    /// Where the PNGs land: `ios/.snapshots/`, which is gitignored.
    private var outputDirectory: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()      // BlunderbaseTests
            .deletingLastPathComponent()      // ios
            .appendingPathComponent(".snapshots")
    }

    func testTheGameScreenRendersWithAGameOnIt() throws {
        let store = try loadedStore()
        store.seek(to: 9)

        let session = Session()
        let screen = GameDetailView(store: store, summary: store.detail?.game)
            .environment(session)
            .environment(EventsClient())
            .preferredColorScheme(.dark)
            .frame(width: 393, height: 852)

        let image = try render(screen, size: CGSize(width: 393, height: 852), named: "game-screen")
        try assertNotBlank(image, name: "game-screen")
    }

    /// The same screen on the smallest phone this app supports.
    ///
    /// The board and the panes share one column, so the board is whatever the panes leave.
    /// On a short screen that subtraction is what breaks first, and it breaks silently —
    /// the layout still renders, the board is just too small to read. Rendering it here at
    /// least puts the failure where somebody will see it.
    func testTheGameScreenRendersOnASmallPhone() throws {
        let store = try loadedStore()
        store.seek(to: 9)

        let size = CGSize(width: 375, height: 667)
        let screen = NavigationStack {
            GameDetailView(store: store, summary: store.detail?.game)
        }
        .environment(Session())
        .environment(EventsClient())

        let image = try render(screen, size: size, named: "game-screen-small")
        try assertNotBlank(image, name: "game-screen-small")
    }

    /// The screen with the engine hidden: no eval bar, so the board has the column; no
    /// glyph on d5; Moves, Book and Notes on the strip and nothing else. The blunder is on
    /// the board so that anything still leaking through would be visible in the picture.
    func testTheGameScreenWithTheEngineHidden() throws {
        let defaults = UserDefaults.standard
        let previous = defaults.object(forKey: Preferences.Key.engineHidden)
        defaults.set(true, forKey: Preferences.Key.engineHidden)
        defer { defaults.set(previous, forKey: Preferences.Key.engineHidden) }

        let store = try loadedStore()
        store.seek(to: 10)

        let size = CGSize(width: 393, height: 852)
        let screen = NavigationStack {
            GameDetailView(store: store, summary: store.detail?.game)
        }
        .environment(Session())
        .environment(EventsClient())

        let image = try render(screen, size: size, named: "game-screen-unaided")
        try assertNotBlank(image, name: "game-screen-unaided")
        XCTAssertTrue(store.engineHidden, "the screen hands the phone's setting to its store")
        XCTAssertNil(store.glyph)
    }

    /// The screen in German: every SwiftUI literal on it comes out of `Localizable.xcstrings`
    /// through the view's locale, and a sentence that stayed English is the one thing this
    /// picture is for. What the picture cannot show is the other half — the strings built
    /// with `String(localized:)` follow the *process* language, which a test cannot switch —
    /// so those are checked against the compiled German table directly.
    func testTheGameScreenInGerman() throws {
        let store = try loadedStore()
        store.seek(to: 10)

        let size = CGSize(width: 393, height: 852)
        let screen = NavigationStack {
            GameDetailView(store: store, summary: store.detail?.game)
        }
        .environment(Session())
        .environment(EventsClient())
        .environment(\.locale, Locale(identifier: "de"))

        let image = try render(screen, size: size, named: "game-screen-de")
        try assertNotBlank(image, name: "game-screen-de")
        // The German table the build compiled out of the catalog, read as the app would
        // read it on a German phone: a tab, a classification, a plural form.
        let german = try XCTUnwrap(
            Bundle.main.path(forResource: "de", ofType: "lproj").flatMap(Bundle.init(path:))
        )
        func de(_ key: String) -> String {
            german.localizedString(forKey: key, value: nil, table: "Localizable")
        }
        XCTAssertEqual(de("Moves"), "Züge")
        XCTAssertEqual(de("Blunder"), "Grober Patzer")
        XCTAssertEqual(
            String(format: de("%lld speeds"), locale: Locale(identifier: "de"), 1),
            "1 Bedenkzeit"
        )
        XCTAssertEqual(
            String(format: de("%lld speeds"), locale: Locale(identifier: "de"), 3),
            "3 Bedenkzeiten"
        )
    }

    /// The screen with a variation open, which is where "back to game" has to be findable.
    func testTheGameScreenInAnAnalysisLine() throws {
        let store = try loadedStore()
        store.seek(to: 9)
        store.playLine(["c6a5", "c4b5"])

        let size = CGSize(width: 393, height: 852)
        let screen = NavigationStack {
            GameDetailView(store: store, summary: store.detail?.game)
        }
        .environment(Session())
        .environment(EventsClient())

        let image = try render(screen, size: size, named: "game-screen-line")
        try assertNotBlank(image, name: "game-screen-line")
    }

    func testEachPaneRenders() throws {
        let store = try loadedStore()
        store.seek(to: 9)

        // The panes are rendered *without* `GamePanes` around them, because its segmented
        // control is a UIKit view and `ImageRenderer` draws those as a yellow unavailable
        // placeholder. A placeholder is colourful, so wrapping them would make this test
        // pass on the one thing it cannot see — the worst kind of green.
        try snapshot(MovesPane(store: store), named: "pane-moves")
        try snapshot(EvalPane(store: store), named: "pane-eval")
        try snapshot(EnginePane(store: store, live: LiveEngineStore(surface: .game, gameID: store.gameID)), named: "pane-engine")
        try snapshot(NotesPane(store: store, isReadOnly: true), named: "pane-notes")

        // The book lives at counts 4 and 8 and the blunder is at 9, so this pane gets its
        // own store on a position that has one — an empty state is a sentence, and a
        // picture of a sentence is not what this test is for.
        let inBook = try loadedStore()
        inBook.seek(to: 8)
        try snapshot(BookPane(store: inBook), named: "pane-book")
    }

    /// The explorer with a line played and a book under it, and the dashboard with numbers
    /// on it: the two screens that are mostly layout, drawn over adopted answers.
    func testTheExplorerAndTheDashboardRender() throws {
        let explorer = ExplorerStore()
        explorer.play(uci: "e2e4")
        explorer.play(uci: "e7e5")
        explorer.play(uci: "g1f3")
        explorer.play(uci: "b8c6")
        explorer.adopt(book: try GameFixture.friedLiver().book?[4])
        let size = CGSize(width: 393, height: 852)
        let explorerScreen = ExplorerView(store: explorer)
            .environment(Session())
            .environment(EventsClient())
        try assertNotBlank(try render(explorerScreen, size: size, named: "explorer"), name: "explorer")

        let dashboard = DashboardStore()
        dashboard.adopt(
            profile: try APIClient.makeDecoder().decode(ProfileResponse.self, from: Data("""
            {"accounts": [], "volume": {"games": 1284},
             "ratings": [{"platform": "lichess", "speed": "blitz", "games": 3,
                          "points": [{"at": "2026-06-01T10:00:00Z", "rating": 1690},
                                     {"at": "2026-07-01T10:00:00Z", "rating": 1650},
                                     {"at": "2026-08-22T18:04:00Z", "rating": 1712}]},
                         {"platform": "chesscom", "speed": "blitz", "games": 2,
                          "points": [{"at": "2026-06-10T10:00:00Z", "rating": 1500},
                                     {"at": "2026-08-01T10:00:00Z", "rating": 1560}]}]}
            """.utf8)),
            allTime: try APIClient.makeDecoder().decode(StatsDashboardResponse.self, from: Data("""
            {"anchor": "2026-08-22T18:04:00Z", "until": "2026-08-22T18:04:00Z",
             "dimensions": {"blunders_by_phase": {"total": {"key": "total", "blunder": 47}}}}
            """.utf8)),
            trends: DashboardStore.Trends(
                window: .month, games: 40, until: nil,
                blundersPerGame: 1.6, winLossPerMove: 3.2, score: 55,
                blundersDelta: -0.4, winLossDelta: -0.5, scoreDelta: 3
            )
        )
        let moments = MomentsStore()
        moments.adopt([])
        let dashboardScreen = DashboardView(store: dashboard, moments: moments)
            .environment(Session())
            .environment(EventsClient())
        try assertNotBlank(try render(dashboardScreen, size: size, named: "dashboard"), name: "dashboard")
    }

    private func snapshot(_ view: some View, named name: String) throws {
        let size = CGSize(width: 393, height: 320)
        let image = try render(
            view.preferredColorScheme(.dark).frame(width: size.width, height: size.height),
            size: size,
            named: name
        )
        try assertNotBlank(image, name: name)
    }

    private func loadedStore() throws -> GameStore {
        let store = GameStore(
            gameID: 1,
            endpoints: Endpoints(serverURL: try XCTUnwrap(URL(string: "https://example.invalid")))
        )
        // Pinned rather than read from the phone, so the unaided snapshot is the only one
        // drawn unaided even after a crashed run left the setting behind.
        store.engineHidden = Preferences.engineHidden
        store.adopt(try GameFixture.friedLiver())
        return store
    }

    // MARK: Rendering

    /// Renders through a real `UIWindow`, not `ImageRenderer`.
    ///
    /// `ImageRenderer` draws SwiftUI's own primitives and nothing else: a segmented
    /// `Picker` comes out as a yellow "unavailable" placeholder, and a `ScrollView` comes
    /// out empty because its content is never laid out. Both are exactly the parts of this
    /// screen worth looking at. Hosting the view in a window on screen and capturing the
    /// layer costs a run loop turn and renders what a person would actually see.
    private func render(_ view: some View, size: CGSize, named name: String) throws -> UIImage {
        let controller = UIHostingController(rootView: view)
        controller.view.frame = CGRect(origin: .zero, size: size)
        controller.view.backgroundColor = UIColor(Theme.void)
        controller.overrideUserInterfaceStyle = .dark

        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = controller
        window.overrideUserInterfaceStyle = .dark
        window.isHidden = false
        window.layoutIfNeeded()
        controller.view.layoutIfNeeded()

        // One turn of the run loop, so lazy stacks build their rows and scroll views lay
        // their content out before the capture.
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))

        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            // `drawHierarchy` captures UIKit-backed subviews, which `layer.render(in:)`
            // misses; falling back to the layer keeps a capture rather than a blank.
            if !controller.view.drawHierarchy(in: controller.view.bounds, afterScreenUpdates: true) {
                controller.view.layer.render(in: context.cgContext)
            }
        }

        try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
        try XCTUnwrap(image.pngData()).write(to: outputDirectory.appendingPathComponent("\(name).png"))
        window.isHidden = true
        return image
    }

    /// A view that failed to lay out still renders — as one flat colour. Counting distinct
    /// colours is the cheapest way to tell "a screen" from "a rectangle".
    private func assertNotBlank(_ image: UIImage, name: String) throws {
        let cgImage = try XCTUnwrap(image.cgImage)
        let width = min(cgImage.width, 200)
        let height = min(cgImage.height, 400)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = try XCTUnwrap(CGContext(
            data: &pixels,
            width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        var colours = Set<UInt32>()
        for index in stride(from: 0, to: pixels.count, by: 4) {
            colours.insert(
                UInt32(pixels[index]) << 16 | UInt32(pixels[index + 1]) << 8 | UInt32(pixels[index + 2])
            )
        }
        XCTAssertGreaterThan(colours.count, 12, "\(name) rendered as an almost flat image")
    }
}
