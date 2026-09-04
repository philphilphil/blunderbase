import SwiftUI

/// The Companion.
///
/// This app is not a Blunderbase — it is the mobile client of one. `docs/distribution.md`
/// puts it plainly: a Companion uses one reachable Installation and does not contain a
/// second implementation of Blunderbase's chess and query rules. So there is no database
/// here, no engine, no analysis, and no opinion about what a move is worth. There is a
/// session pointed at a server, and screens that read it.
///
/// The one piece of chess logic the phone does own is replaying a move list onto a board,
/// because the API sends moves and not positions. Deciding where a knight ends up is not
/// deciding what the knight was worth.
@main
struct BlunderbaseApp: App {
    @State private var session = Session()

    /// One events socket for the whole app.
    ///
    /// It is here rather than on the game screen because holding it open is what keeps a
    /// live analysis board alive — the server reaps an idle stream after thirty seconds and
    /// any connected client resets that timer. A socket owned by a screen would die on the
    /// way to the games list and take the analysis with it.
    @State private var events = EventsClient()

    /// The theme, at the top of the window so that every sheet, alert and keyboard the app
    /// puts up is in it too — a `preferredColorScheme` further down would leave the system
    /// chrome following the phone while the screens did not. `system` resolves to `nil`,
    /// which is the absence of an override rather than a third look.
    @AppStorage(Preferences.Key.appearance) private var appearance = Preferences.Appearance.system

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(events)
                .preferredColorScheme(appearance.colorScheme)
                .tint(Theme.accent)
                .task { await session.restore() }
        }
    }
}
