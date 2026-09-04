import Foundation

/// The handful of per-device choices the settings screen offers.
///
/// They are Device-local Data in `docs/distribution.md`'s sense: how this phone likes to
/// draw a board, not something about the Library, so they live in `UserDefaults` and never
/// travel to the server.
///
/// This type exists so the keys are written once. `SettingsView` binds to them through
/// `@AppStorage`, which is the right tool for a switch bound to a view; everything else
/// reads them here, where a renamed key is one edit rather than a search. A missing value
/// reads as the default rather than as `false`, which is the mistake `UserDefaults.bool`
/// makes and the reason these go through `object(forKey:)`.
enum Preferences {

    enum Key {
        static let ownerAtBottom = "blunderbase.ownerAtBottom"
        static let showHints = "blunderbase.showHints"
        static let haptics = "blunderbase.haptics"
    }

    /// Whether the owner's side is drawn at the bottom of the board. Off means White always
    /// is, which is what somebody who reads games as diagrams wants.
    static var ownerAtBottom: Bool { flag(Key.ownerAtBottom) }

    /// Whether a new game opens with the engine and Maia arrows up.
    static var showHints: Bool { flag(Key.showHints) }

    private static func flag(_ key: String, default fallback: Bool = true) -> Bool {
        UserDefaults.standard.object(forKey: key) as? Bool ?? fallback
    }
}
