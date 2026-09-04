import Foundation
import Observation

/// What a subscriber to `/events` hears.
///
/// One channel rather than several, because the three things a consumer has to act on are
/// ordered with respect to each other: a reconnect means whatever it missed is gone, and a
/// frame that arrives after it is about the world as it stands now.
enum EventsSignal: Sendable {
    /// The socket is up. `afterDrop` is false only for the first connection of a run —
    /// every later one means frames were missed, because nothing is replayed.
    case connected(afterDrop: Bool)
    /// The socket went away. A reconnect is already scheduled unless it was deliberate.
    case disconnected
    case stream(StreamEvent)
    /// The server refused the cookie. The app signs out; this client does not retry.
    case unauthorized
}

/// The half of `EventsClient` a consumer needs, so a store can be driven by injected frames
/// in a test instead of by a socket.
@MainActor
protocol EventsFeed: AnyObject {
    var isConnected: Bool { get }
    func subscribe(_ handler: @escaping (EventsSignal) -> Void) -> EventsSubscription
}

/// A subscription, cancelled by hand.
///
/// Deliberately not cancelled from `deinit`: the registry lives on the main actor and a
/// deinit does not, and an owner that forgets to cancel leaks one closure rather than
/// crossing actors to tidy up. Every owner here cancels in its own teardown.
@MainActor
final class EventsSubscription {
    private var stop: (() -> Void)?

    init(stop: @escaping () -> Void) {
        self.stop = stop
    }

    func cancel() {
        stop?()
        stop = nil
    }
}

/// The one WebSocket the app holds open, and everything that keeps it open.
///
/// **Holding this socket open is what keeps a live search alive.** The backend reaps an
/// analysis board that nobody has been listening to for thirty seconds, and any connected
/// `/events` client resets that clock for every open session. So this is not an
/// optimisation over polling — closing it kills the search half a minute later.
///
/// The protocol is one-way. The server sends `{"event": "ping"}` after thirty seconds of
/// silence and reads nothing at all; there is no subscribe frame and no pong to send, so
/// this client never writes to the socket.
///
/// Delivery is lossy on purpose (the server drops a slow client's oldest frames) and nothing
/// is replayed after a reconnect. That is why a reconnect is a signal in its own right:
/// a consumer has to go and ask what it missed.
@Observable
@MainActor
final class EventsClient: EventsFeed {

    /// Whether frames are arriving right now. Views read it to say "live" or "reconnecting".
    private(set) var isConnected = false
    /// How many times the socket has come back after a drop. Also the thing that makes a
    /// reconnect visible to a consumer that was not subscribed at the time.
    private(set) var reconnects = 0
    /// The last thing that went wrong, for a diagnostics row. Never a reason to stop.
    private(set) var lastError: String?

    /// 500 ms doubling to 8 s. Long enough that a server restarting is not hammered, short
    /// enough that a phone coming back from a tunnel picks the search up again.
    private static let minimumBackoff: TimeInterval = 0.5
    private static let maximumBackoff: TimeInterval = 8

    /// `backend/api/auth.py` accepts the socket and then closes it with code 4401 and the
    /// guard's own word as the reason. The **reason** is what is matched rather than the
    /// code: `URLSessionWebSocketTask.CloseCode` is an `@objc` enum with no case for 4401,
    /// so reading a value outside its cases back into Swift is not something to build a
    /// sign-out on. The reason string is sent by this server and is unambiguous.
    private static let unauthorizedReasons: Set<String> = ["unauthorized", "setup_required"]

    private let urlSession: URLSession
    private let socketDelegate = SocketDelegate()
    private let decoder = APIClient.makeDecoder()

    private var serverURL: URL?
    private var task: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    /// Whether a connection is wanted at all. A drop reconnects only while this is true, so
    /// `disconnect()` and a 4401 both stop the ladder by clearing it.
    private var wantsConnection = false
    private var attempt = 0
    private var hasConnected = false

    private var listeners: [Int: (EventsSignal) -> Void] = [:]
    private var nextToken = 0

    /// The cookie jar is the shared one, the same as `APIClient`'s: the handshake is an HTTP
    /// request and carries `blunderbase_session` like any other. The header is also set by
    /// hand below, which is belt and braces rather than a workaround.
    init(configuration: URLSessionConfiguration? = nil) {
        let session = URLSession(
            configuration: configuration ?? APIClient.makeConfiguration(),
            delegate: socketDelegate,
            delegateQueue: nil
        )
        urlSession = session
        socketDelegate.opened = { [weak self] in
            Task { @MainActor in self?.socketOpened() }
        }
        socketDelegate.closed = { [weak self] reason in
            Task { @MainActor in self?.socketClosed(reason: reason) }
        }
    }

    deinit {
        // The session holds the delegate for the life of the process otherwise, and with it
        // whatever socket was open. Nothing else uses this session.
        urlSession.invalidateAndCancel()
    }

    // MARK: Subscribers

    func subscribe(_ handler: @escaping (EventsSignal) -> Void) -> EventsSubscription {
        nextToken += 1
        let token = nextToken
        listeners[token] = handler
        return EventsSubscription { [weak self] in
            self?.listeners.removeValue(forKey: token)
        }
    }

    private func emit(_ signal: EventsSignal) {
        // A copy: a handler is free to cancel its own subscription while it runs.
        for handler in Array(listeners.values) {
            handler(signal)
        }
    }

    // MARK: Connecting

    /// Point the socket at a server and keep it there. Safe to call again with the same URL.
    func connect(to serverURL: URL) {
        if self.serverURL == serverURL, wantsConnection, task != nil { return }
        self.serverURL = serverURL
        wantsConnection = true
        attempt = 0
        openSocket()
    }

    /// Deliberate teardown: no reconnect, and the server's reaper closes whatever searches
    /// this client was keeping alive about thirty seconds later.
    func disconnect() {
        wantsConnection = false
        retryTask?.cancel()
        retryTask = nil
        closeSocket()
        isConnected = false
    }

    private func openSocket() {
        guard wantsConnection, let serverURL, let url = EventsClient.socketURL(for: serverURL) else { return }
        closeSocket()

        var request = URLRequest(url: url)
        // The session's cookie storage should do this on the handshake by itself. Setting it
        // explicitly costs one lookup and removes the question: a socket that silently
        // authenticates as nobody looks exactly like a server that has gone quiet.
        if let cookies = HTTPCookieStorage.shared.cookies(for: serverURL), !cookies.isEmpty {
            for (header, value) in HTTPCookie.requestHeaderFields(with: cookies) {
                request.setValue(value, forHTTPHeaderField: header)
            }
        }

        let socket = urlSession.webSocketTask(with: request)
        task = socket
        socket.resume()
        listen(on: socket)
    }

    /// One receive loop per socket. It ends on the first failure, which is either the close
    /// the delegate has already reported or the drop that schedules the next attempt.
    private func listen(on socket: URLSessionWebSocketTask) {
        receiveTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let message = try await socket.receive()
                    guard let self, self.task === socket else { return }
                    self.handle(message)
                } catch {
                    guard let self, self.task === socket else { return }
                    self.lastError = error.localizedDescription
                    self.dropped()
                    return
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case let .string(text):
            // A frame arriving is proof the connection works, whatever it said — including
            // the keepalive ping, which is the only traffic on an idle socket.
            attempt = 0
            guard let event = StreamEventDecoding.decode(Data(text.utf8), using: decoder) else { return }
            emit(.stream(event))
        case .data:
            // Nothing on this socket is binary. Said out loud rather than ignored, because a
            // server that started sending binary would otherwise look like one gone silent.
            lastError = "The server sent a binary frame on /events, which this app does not read."
        @unknown default:
            break
        }
    }

    // MARK: The socket's own life

    private func socketOpened() {
        isConnected = true
        attempt = 0
        let afterDrop = hasConnected
        if hasConnected { reconnects += 1 }
        hasConnected = true
        emit(.connected(afterDrop: afterDrop))
    }

    /// The server closed it. The reason is the only reliable way to tell "your cookie is no
    /// good" from "this server is going away", and the two want opposite behaviour.
    private func socketClosed(reason: String?) {
        guard task != nil else { return }
        if let reason, EventsClient.unauthorizedReasons.contains(reason) {
            wantsConnection = false
            closeSocket()
            isConnected = false
            // Not retried, ever: the answer to a refused cookie is the sign-in screen, and
            // a reconnect ladder against it is a loop that never ends and never helps.
            emit(.unauthorized)
            return
        }
        dropped()
    }

    /// An ordinary drop: the socket is gone, the frames it would have carried are lost, and
    /// the next attempt is scheduled.
    private func dropped() {
        guard task != nil else { return }
        closeSocket()
        isConnected = false
        emit(.disconnected)
        scheduleReconnect()
    }

    private func closeSocket() {
        receiveTask?.cancel()
        receiveTask = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func scheduleReconnect() {
        guard wantsConnection else { return }
        let step = EventsClient.minimumBackoff * pow(2, Double(attempt))
        attempt += 1
        // Full jitter downwards, so a server coming back does not get every phone at once
        // on the same tick.
        let delay = min(EventsClient.maximumBackoff, step) * Double.random(in: 0.5...1)
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.openSocket()
        }
    }

    // MARK: The URL

    /// `https://host/base` becomes `wss://host/base/events`.
    ///
    /// `/events` is at the server's root and **not** under `/api`, which is the one place
    /// this differs from every other call the app makes. A deployment behind a path prefix
    /// keeps that prefix, which is why the path is built rather than replaced.
    static func socketURL(for serverURL: URL) -> URL? {
        guard var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else {
            return nil
        }
        switch components.scheme?.lowercased() {
        case "https": components.scheme = "wss"
        case "http": components.scheme = "ws"
        default: return nil
        }
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        components.path = path + "/events"
        components.query = nil
        components.fragment = nil
        return components.url
    }
}

/// The delegate exists for one fact the receive loop cannot see: how the socket was closed.
///
/// `receive()` throwing says only that it stopped. Whether the server said 4401 — and with
/// which word — arrives here and nowhere else, and that difference is a sign-out rather than
/// a retry.
private final class SocketDelegate: NSObject, URLSessionWebSocketDelegate {
    var opened: (@Sendable () -> Void)?
    var closed: (@Sendable (String?) -> Void)?

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        opened?()
    }

    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        closed?(reason.flatMap { String(data: $0, encoding: .utf8) })
    }
}
