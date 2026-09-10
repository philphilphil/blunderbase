import Foundation

/// The state the process was told to open in, read once from its launch arguments.
///
/// Judging a screen means looking at it, and looking at it means tapping through to the
/// place it lives — sign in, pick a tab, find a game — again after every erased simulator
/// and every reinstall. These arguments are the way past that: `make ios-run
/// args="--game 123"` puts the app on that game with no taps and `make ios-shot`
/// photographs it, so a layout can be inspected from the terminal.
///
/// Reading them is not a feature of the app. `current` parses `ProcessInfo` only in a debug
/// build; a release build gets an empty `LaunchState` and therefore ignores anything on its
/// command line, so every screen behaves exactly as it does today. The parser itself is
/// compiled either way, because a `#if DEBUG` around the type would take the test that
/// covers it with it, and a parser that is only compiled in the configuration nobody tests
/// is the one that breaks.
struct LaunchState: Equatable {
    /// Which tab to open on, or nil for the app's own default.
    var tab: RootTab?
    /// A game to push on top of the games tab, from `--game <id>`.
    var gameID: Int?
    /// The address to store and sign in to, from `--server <url>`. Goes through
    /// `Session.connect(to:)`, so it is normalised like a typed one.
    var server: String?
    var password: String?

    /// What this process was launched with. A `static let` so the arguments are read once
    /// and every screen that asks sees the same answer.
    static let current: LaunchState = {
        #if DEBUG
        return LaunchState(arguments: ProcessInfo.processInfo.arguments)
        #else
        return LaunchState()
        #endif
    }()

    init() {}

    /// Arguments this does not recognise are ignored rather than refused. The simulator and
    /// XCTest both add their own — `-XCTest`, `-ApplePersistenceIgnoreState` — and an app
    /// that refused to launch over one of those would be broken in exactly the place this is
    /// tested. A flag that wants a value takes the next word unless that word is itself a
    /// flag, so `--server --games` names no server rather than swallowing the tab.
    init(arguments: [String]) {
        let words = Array(arguments.dropFirst())  // argv[0] is the executable
        var index = 0

        func value() -> String? {
            guard index < words.count, !words[index].hasPrefix("--") else { return nil }
            defer { index += 1 }
            return words[index]
        }

        while index < words.count {
            let word = words[index]
            index += 1
            switch word {
            case "--dashboard": tab = .dashboard
            case "--games": tab = .games
            case "--explorer": tab = .explorer
            case "--notes": tab = .notes
            case "--settings": tab = .settings
            case "--game":
                guard let raw = value(), let id = Int(raw) else { break }
                gameID = id
                // A game is only ever reached through the library, and the back button has
                // to land somewhere, so naming a game names the tab it is pushed on.
                tab = .games
            case "--server": server = value()
            case "--password": password = value()
            default: break
            }
        }
    }

    /// Get the session ready, either from the arguments or the way launch normally does it.
    ///
    /// This *replaces* `Session.restore()` rather than running before or after it, and the
    /// ordering is the whole point. `restore()` reads the stored address and asks the server
    /// about the cookie it already holds; on a freshly erased simulator there is no stored
    /// address, so it settles on `.needsServer` and the connect screen goes up before
    /// `--server` has been looked at — and a second pass afterwards would be two bootstraps
    /// racing for the same state. `connect(to:)` does everything `restore()` does and stores
    /// the address besides, so the launch path is one call.
    @MainActor
    func signIn(_ session: Session) async {
        guard let server else {
            await session.restore()
            return
        }
        await session.connect(to: server)
        // A cookie that survived the last run is already signed in — the password is for the
        // erased simulator, and offering one the server did not ask for is a wasted round
        // trip and a wrong password message where there is no problem.
        if case .signedOut = session.state, let password {
            await session.signIn(password: password)
        }
    }
}
