import SwiftUI

/// What the app shows: the tabs, or the way in.
///
/// There is no tab bar until there is a server to read, because every tab would be empty
/// and the sign-in would be a modal over three dead screens. The connect screen is
/// therefore the whole window rather than a sheet, and the tabs replace it once the session
/// is good. A session that goes stale later — the cookie expired, the password changed —
/// puts the connect screen back the same way, from wherever the user was.
///
/// Three tabs, and only three. Games is the app; Notes is the reason to have written any;
/// Settings is where the server lives. Anything else the web app does is a reason to open
/// the web app.
struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(EventsClient.self) private var events
    @State private var subscription: EventsSubscription?

    var body: some View {
        Group {
            if session.isSignedIn {
                tabs
            } else {
                ConnectView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: session.isSignedIn)
        .onChange(of: session.isSignedIn, initial: true) { _, signedIn in
            // The socket follows the session rather than the screen. Signed out there is
            // nothing to listen to and the server would refuse the handshake anyway.
            if signedIn, let url = session.serverURL {
                events.connect(to: url)
            } else {
                events.disconnect()
            }
        }
        .onAppear {
            // A socket refused with close code 4401 means the cookie died while the app was
            // open. The client deliberately does not retry that, so somebody has to turn it
            // into a sign-out, and this is the only view that outlives every screen.
            subscription = events.subscribe { signal in
                if case .unauthorized = signal {
                    session.handle(APIError.unauthorized)
                }
            }
        }
        .onDisappear {
            subscription?.cancel()
            subscription = nil
        }
    }

    private var tabs: some View {
        TabView {
            GamesListView()
                .tabItem { Label("Games", systemImage: "square.grid.2x2") }

            NotesListView()
                .tabItem { Label("Notes", systemImage: "text.quote") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .tint(Theme.accent)
    }
}
