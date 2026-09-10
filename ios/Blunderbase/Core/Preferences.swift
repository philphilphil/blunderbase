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
        static let engineHidden = "blunderbase.engineHidden"
        static let hiddenRatingSpeeds = "blunderbase.hiddenRatingSpeeds"
    }

    /// The dashboard's rating charts a reader has switched off, by speed.
    ///
    /// The web's `ratingSpeeds.ts`, with the same twist: the stored set is what is *hidden*
    /// rather than what is shown, so a speed that starts appearing later — a first bullet
    /// game — is visible without this ever having heard of it. A view preference of this
    /// phone, not a fact about the library.
    static var hiddenRatingSpeeds: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: Key.hiddenRatingSpeeds) ?? []) }
        set { UserDefaults.standard.set(Array(newValue).sorted(), forKey: Key.hiddenRatingSpeeds) }
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
            case .system: return String(localized: "System")
            case .dark: return String(localized: "Dark")
            case .light: return String(localized: "Light")
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

    /// Whether the engine is allowed to speak at all, on this phone.
    ///
    /// The web app's ⇧E (`web/src/lib/ui/engineVisibility.ts`): read a game the way it would
    /// be annotated on paper, decide for yourself where it went wrong, and only then ask
    /// Stockfish. A verdict already on the screen cannot be un-read, so the switch has to
    /// come before the reading — which is why it is a mode that survives navigation and
    /// relaunches rather than a button on one screen, and why it is distinct from
    /// `showHints`: hints are one game's "not yet" for the arrows, this is every screen's
    /// "not at all" for the numbers hints keeps — the eval bar, the score, the glyphs, the
    /// curve, the flags on the list.
    ///
    /// It hides what the engine *said*, never what Blunderbase *did*: which pass has run
    /// stays on the row, and a filter set to "only games with blunders" is a question the
    /// reader typed rather than an answer they were handed. Off by default, as on the web.
    static var engineHidden: Bool { flag(Key.engineHidden, default: false) }

    /// Strip every engine verdict off a move list, leaving the game.
    ///
    /// The web does this once at the top of the game page (`withoutEngine` in
    /// `gameModel.ts`) and lets every panel read the result, so that hiding the engine is
    /// one decision rather than a check in each place a number is drawn. The same here: the
    /// classification, the evaluations, the win percentages, the best move, the lines and
    /// Maia's distribution go; the move, the clock and who played it stay.
    static func withoutEngine(_ moves: [MoveRow]) -> [MoveRow] {
        moves.map { move in
            var unaided = move
            unaided.evalBeforeCp = nil
            unaided.evalBeforeMate = nil
            unaided.evalAfterCp = nil
            unaided.evalAfterMate = nil
            unaided.winBefore = nil
            unaided.winAfter = nil
            unaided.winLoss = nil
            unaided.classification = nil
            unaided.bestMoveUci = nil
            unaided.bestLines = nil
            unaided.maia = nil
            return unaided
        }
    }

    /// The stored theme choice, or `system` when there is none.
    static var appearance: Appearance {
        UserDefaults.standard.string(forKey: Key.appearance)
            .flatMap(Appearance.init(rawValue:)) ?? .system
    }

    private static func flag(_ key: String, default fallback: Bool = true) -> Bool {
        UserDefaults.standard.object(forKey: key) as? Bool ?? fallback
    }
}
