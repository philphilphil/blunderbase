import SwiftUI

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
        static let appearance = "blunderbase.appearance"
    }

    /// Which of the two themes the app draws in.
    ///
    /// The web app's default is `dark` — it is the flagship look and a browser has no
    /// setting of its own to inherit. A phone does, so the default here is `system`:
    /// somebody who reads at night with the OS in dark mode has already said what they
    /// want, and asking them again in a settings screen would be the app disagreeing with
    /// the phone. `dark` and `light` are the two ways to overrule that for this app alone.
    ///
    /// String-backed because that is what `@AppStorage` can keep, and because a stored
    /// value that no longer parses — a case removed in a later version — falls back to
    /// `system` rather than to whichever case happens to be first.
    enum Appearance: String, CaseIterable, Identifiable {
        case system
        case dark
        case light

        var id: String { rawValue }

        var label: String {
            switch self {
            case .system: return "System"
            case .dark: return "Dark"
            case .light: return "Light"
            }
        }

        /// What to hand `.preferredColorScheme`. `nil` is the one that means "do not
        /// override", which is exactly what following the phone is.
        var colorScheme: ColorScheme? {
            switch self {
            case .system: return nil
            case .dark: return .dark
            case .light: return .light
            }
        }
    }

    /// Whether the owner's side is drawn at the bottom of the board. Off means White always
    /// is, which is what somebody who reads games as diagrams wants.
    static var ownerAtBottom: Bool { flag(Key.ownerAtBottom) }

    /// Whether a new game opens with the engine and Maia arrows up.
    static var showHints: Bool { flag(Key.showHints) }

    /// The stored theme choice, or `system` when there is none.
    static var appearance: Appearance {
        UserDefaults.standard.string(forKey: Key.appearance)
            .flatMap(Appearance.init(rawValue:)) ?? .system
    }

    private static func flag(_ key: String, default fallback: Bool = true) -> Bool {
        UserDefaults.standard.object(forKey: key) as? Bool ?? fallback
    }
}
