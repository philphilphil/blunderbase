import Foundation
import Observation

/// Which server the app is talking to, and whether it is signed in.
///
/// Everything about identity lives here because there is exactly one of each: one server,
/// one password, one cookie. A screen never builds an `Endpoints`, never reads the stored
/// URL and never decides what a 401 means — it reads `state`, calls one of the four verbs,
/// and hands anything that goes wrong to `handle(_:)`.
///
/// The cookie is not kept here. `HTTPCookieStorage.shared` persists it to disk, so what
/// `restore()` does on launch is ask the server whether the cookie it already has still
/// works, rather than replay a token this class saved.
@Observable
@MainActor
final class Session {
    /// Where the app is in the one flow it has. `.checking` is any call in flight — the
    /// bootstrap, a sign-in, a restore — so a view shows a spinner without knowing which.
    enum State: Equatable {
        /// No server has been named yet: first launch, or the URL was cleared.
        case needsServer
        case checking
        /// The server exists but has no password. That is set in the web app, not here.
        case needsSetup
        case signedOut
        case signedIn(AuthStatus)
        /// Something went wrong and the person has to decide what to do about it. Read
        /// `hasServer` to know whether to offer the password field or the address field.
        case failed(String)
    }

    static let serverURLKey = "blunderbase.serverURL"

    private(set) var state: State = .needsServer
    private(set) var serverURL: URL?
    private(set) var capabilities: RuntimeCapabilities?
    private(set) var maiaElos: [Int] = []
    /// The level a single-level screen shows. Falls back to the backend's own default rather
    /// than to nothing, because every Maia question is asked at a rating and there is no
    /// sensible "no level" to render.
    private(set) var maiaTargetElo: Int = AuthStatus.defaultMaiaTargetElo

    /// Built when a server is named and thrown away when one replaces it, so a call can
    /// never go to the previous address. Nil exactly when `serverURL` is.
    private(set) var endpoints: Endpoints?

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// True once an address has been stored — what a `.failed` screen needs to know to
    /// decide which form it is showing.
    var hasServer: Bool { serverURL != nil }

    /// The demo deployment refuses every write at the door, so the composer hides rather
    /// than letting somebody type a note the server will turn down.
    var isReadOnly: Bool { capabilities?.readOnly ?? false }

    var isSignedIn: Bool {
        if case .signedIn = state { return true }
        return false
    }

    // MARK: Launch

    /// The first call of the app's life. A stored URL plus a surviving cookie is the common
    /// case and lands straight on `.signedIn` with no password typed.
    func restore() async {
        guard let stored = defaults.string(forKey: Session.serverURLKey),
              let url = Session.normalisedURL(from: stored)
        else {
            state = .needsServer
            return
        }
        use(url)
        await refresh()
    }

    // MARK: The four verbs

    /// Point the app at a server. Takes what the owner typed rather than a `URL`, because
    /// what they type is `chess.example.com` — see `normalisedURL(from:)`.
    ///
    /// The address is stored before the call rather than after it: a server that is
    /// unreachable right now is still the server they meant, and making them type it again
    /// on the train is worse than remembering a URL that turned out to be wrong.
    func connect(to urlString: String) async {
        guard let url = Session.normalisedURL(from: urlString) else {
            state = .failed("That does not look like a server address.")
            return
        }
        use(url)
        defaults.set(url.absoluteString, forKey: Session.serverURLKey)
        await refresh()
    }

    func signIn(password: String) async {
        guard let endpoints else {
            state = .needsServer
            return
        }
        state = .checking
        do {
            apply(try await endpoints.login(password: password))
        } catch let error as APIError {
            // A wrong password is a 401 like any other, but it must not read as "the session
            // ended" — the person is standing at the sign-in screen already.
            state = .failed(signInMessage(for: error))
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// Signs out here whatever the server says: a logout that failed on the network still
    /// means the person asked to be signed out, and leaving them looking at a signed-in shell
    /// would be answering a different question.
    func signOut() async {
        if let endpoints {
            try? await endpoints.logout()
        }
        forgetCookie()
        capabilities = nil
        state = serverURL == nil ? .needsServer : .signedOut
    }

    /// Ask the server what it thinks of the cookie we hold. Also the way back from `.failed`.
    func refresh() async {
        guard let endpoints else {
            state = .needsServer
            return
        }
        state = .checking
        do {
            apply(try await endpoints.authStatus())
        } catch let error as APIError {
            switch error {
            case .setupRequired: state = .needsSetup
            case .unauthorized: state = .signedOut
            default: state = .failed(error.localizedDescription)
            }
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    /// Where every screen sends a failure it cannot handle itself.
    ///
    /// One thing matters here: a 401 from anywhere means the cookie is gone, and the whole
    /// app has to go back to the sign-in screen — the list that happened to be on screen
    /// when it arrived is not the right place to report it. Everything else is the caller's
    /// own problem and is deliberately left alone, so a failed page load does not blank the
    /// app.
    func handle(_ error: Error) {
        guard let apiError = error as? APIError else { return }
        switch apiError {
        case .unauthorized:
            capabilities = nil
            state = .signedOut
        case .setupRequired:
            state = .needsSetup
        default:
            break
        }
    }

    // MARK: Internals

    private func use(_ url: URL) {
        guard serverURL != url else { return }
        serverURL = url
        endpoints = Endpoints(serverURL: url)
    }

    private func apply(_ status: AuthStatus) {
        capabilities = status.capabilities
        maiaTargetElo = status.maiaTargetOrDefault
        maiaElos = status.maiaElos ?? [status.maiaTargetOrDefault]
        if status.setupRequired {
            state = .needsSetup
        } else if status.authenticated {
            state = .signedIn(status)
        } else {
            state = .signedOut
        }
    }

    private func signInMessage(for error: APIError) -> String {
        switch error {
        case .unauthorized: return "That password was not accepted."
        default: return error.localizedDescription
        }
    }

    /// The server clears the cookie on logout, but only if the request got there. Clearing
    /// the local copy as well is what makes a logout on a dead network still a logout.
    private func forgetCookie() {
        guard let serverURL, let cookies = HTTPCookieStorage.shared.cookies(for: serverURL) else {
            return
        }
        for cookie in cookies {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    /// What the owner types into an address field is not a URL.
    ///
    /// They type `chess.example.com`, or paste the address bar with the trailing slash, or
    /// paste the API root they found in the docs. All three mean the same server, and the
    /// client appends `/api` itself — so a stored `.../api` would produce `.../api/api` and
    /// a confusing 404 rather than a wrong-address message. Everything is normalised once,
    /// here, and only `http`/`https` with a host survives.
    static func normalisedURL(from raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") { text = "https://" + text }
        while text.hasSuffix("/") { text.removeLast() }
        if text.lowercased().hasSuffix("/api") { text.removeLast(4) }
        while text.hasSuffix("/") { text.removeLast() }
        guard let url = URL(string: text),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host,
              !host.isEmpty
        else { return nil }
        return url
    }
}
