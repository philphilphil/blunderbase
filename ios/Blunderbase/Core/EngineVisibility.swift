import SwiftUI

/// The two faces of one switch: whether the engine may speak on this phone.
///
/// The web puts it in the title bar, on every screen, as a lit computer that goes dark;
/// the phone has no title bar that every screen shares, so the same switch is drawn three
/// times over one key — a button on the games list, a menu item on the game, a toggle in
/// Settings with the sentence that explains it. All three bind the same `@AppStorage`, so
/// none of them can disagree, and each reads back the other's flip on the next frame.
///
/// The flip is deliberately not confirmed and not animated: it is a mode the reader sets
/// before opening a game, and a sheet in the way of that would be the app asking whether
/// they meant it.
struct EngineVisibilityToggle: View {
    @Binding var engineHidden: Bool

    var body: some View {
        Button {
            engineHidden.toggle()
            Haptics.selectionChanged()
        } label: {
            Label(engineHidden ? "Show the engine" : "Hide the engine", systemImage: "desktopcomputer")
        }
    }
}

/// The lit computer, for a navigation bar.
///
/// Lit while the engine speaks and dimmed while it is hidden — said by light alone, as the
/// web's titlebar says it, because the symbol has no slashed variant and a badge would read
/// as a fault. The dimmed state is the one worth noticing: a reader who forgot the mode is
/// on would otherwise open a game and take a clean move list for an unanalysed one.
struct EngineVisibilityButton: View {
    @Binding var engineHidden: Bool

    var body: some View {
        Button {
            engineHidden.toggle()
            Haptics.selectionChanged()
        } label: {
            Image(systemName: "desktopcomputer")
                .foregroundStyle(engineHidden ? Theme.faint : Theme.accent)
        }
        .accessibilityLabel(engineHidden ? "Show the engine" : "Hide the engine")
    }
}
