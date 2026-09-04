import UIKit

/// The board's sense of touch.
///
/// The web board has a synthesised click for every move (`web/src/lib/board/moveSound.ts`).
/// A phone is often used with the sound off, so the phone's equivalent is haptic rather
/// than audible, and it follows the same idea: the feedback is a *family*, where a plain
/// move, a capture and landing on a mistake are relatives that differ in weight, so a run
/// through a game feels like a run rather than a string of identical taps.
///
/// Everything here is best-effort. A device without a Taptic Engine, or a user who has
/// turned system haptics off, simply gets nothing — no code path checks for availability
/// because `UIFeedbackGenerator` already does the right thing when it is unavailable.
@MainActor
enum Haptics {

    /// The settings screen's "Haptics" switch, read at the point of use.
    ///
    /// Read rather than injected because the alternative is threading a preference through
    /// the store, the board and every gesture to reach four call sites. A defaults lookup is
    /// a dictionary read, and the switch takes effect on the next tap rather than the next
    /// launch. The key is the one `SettingsView` declares; the default is on, so a fresh
    /// install feels like a board rather than a spreadsheet.
    static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: Preferences.Key.haptics) as? Bool ?? true
    }

    private static let light = UIImpactFeedbackGenerator(style: .light)
    private static let medium = UIImpactFeedbackGenerator(style: .medium)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private static let selection = UISelectionFeedbackGenerator()

    /// Call before a run of steps so the engine is warm and the first tap is not late.
    static func prepare() {
        guard isEnabled else { return }
        light.prepare()
        medium.prepare()
        rigid.prepare()
    }

    /// One move forward or back.
    static func step() {
        guard isEnabled else { return }
        light.impactOccurred(intensity: 0.55)
    }

    /// A move that took a piece — the same tap struck harder, as in the web's capture sound.
    static func capture() {
        guard isEnabled else { return }
        rigid.impactOccurred(intensity: 0.8)
    }

    /// Landing on a move the engine flagged. Heavier than a step on purpose: while
    /// scrubbing, this is how the hand notices the game turned without watching the strip.
    static func flagged() {
        guard isEnabled else { return }
        medium.impactOccurred(intensity: 0.9)
    }

    /// Moving between discrete choices — a segmented control, a level picker.
    static func selectionChanged() {
        guard isEnabled else { return }
        selection.selectionChanged()
    }
}
