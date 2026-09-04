import Foundation
import Observation

// MARK: - The control side

/// The four REST calls that drive an analysis board.
///
/// A protocol because the store's whole job is a lifecycle — open, move, reopen, close —
/// and the only honest way to test a lifecycle is to run it against something that answers
/// on command. Nothing here is `/events`; the output arrives there.
protocol StreamsTransport: Sendable {
    /// 201, or a refusal that is final: `stream_limit`, `stream_unavailable`,
    /// `invalid_request`. The server never queues and never hangs.
    func open(_ body: StreamCreate) async throws -> StreamResponse
    /// A new position or a new line count on the same slot. A 404 means the session is gone.
    func update(_ id: String, _ body: StreamUpdate) async throws -> StreamResponse
    func close(_ id: String) async throws
    /// Every board this server has open. Asked after a reconnect, and nowhere else.
    func list() async throws -> [StreamResponse]
}

/// `/api/streams`, over the same cookie-backed session as the rest of the app.
///
/// It builds its own requests rather than going through `APIClient` because that type has
/// no `PATCH` and no `DELETE`, and adding them there was not this change's to make. The
/// configuration recipe is `APIClient.makeConfiguration()` and the decoder is
/// `APIClient.makeDecoder()`, so the cookie jar and the date rule are the app's own; only
/// the two verbs are new.
actor StreamsAPI: StreamsTransport {
    private let serverURL: URL
    private let apiPath: String
    private let urlSession: URLSession
    private let decoder = APIClient.makeDecoder()
    private let encoder = JSONEncoder()

    init(serverURL: URL, configuration: URLSessionConfiguration? = nil) {
        self.serverURL = serverURL
        var path = serverURL.path
        while path.hasSuffix("/") { path.removeLast() }
        apiPath = path + "/api"
        urlSession = URLSession(configuration: configuration ?? APIClient.makeConfiguration())
    }

    func open(_ body: StreamCreate) async throws -> StreamResponse {
        let data = try await send("/streams", method: "POST", body: encode(body))
        return try decode(data, as: StreamResponse.self)
    }

    func update(_ id: String, _ body: StreamUpdate) async throws -> StreamResponse {
        let data = try await send("/streams/\(id)", method: "PATCH", body: encode(body))
        return try decode(data, as: StreamResponse.self)
    }

    func close(_ id: String) async throws {
        _ = try await send("/streams/\(id)", method: "DELETE", body: nil)
    }

    func list() async throws -> [StreamResponse] {
        let data = try await send("/streams", method: "GET", body: nil)
        return try decode(data, as: [StreamResponse].self)
    }

    // MARK: Plumbing

    private func encode<B: Encodable>(_ body: B) throws -> Data {
        do {
            return try encoder.encode(body)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func send(_ path: String, method: String, body: Data?) async throws -> Data {
        guard var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else {
            throw APIError.transport(URLError(.badURL))
        }
        components.path = apiPath + path
        guard let url = components.url else { throw APIError.transport(URLError(.badURL)) }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: request)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport(URLError(.badServerResponse))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.from(status: http.statusCode, data: data)
        }
        return data
    }

    private func decode<T: Decodable>(_ data: Data, as type: T.Type) throws -> T {
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }
}

// MARK: - The store

/// One live analysis board: the toggle, the session behind it, and the newest frame.
///
/// The shape is taken from the web app's `useStreamSession`, and the parts that look fussy
/// are all the same fact — **the board can move faster than the search can be told about
/// it**, so the panel's job is as much about refusing frames as about drawing them.
///
/// Three rules decide whether a frame is drawn, and all three have to hold:
///
/// 1. the session id matches the one that is open,
/// 2. `seq` is ahead of the last frame accepted, because delivery is lossy and may reorder,
/// 3. the frame's FEN equals **the FEN the server echoed back**, not the one we sent — the
///    server normalises the spelling, and during a restart there is no such FEN at all.
///
/// The last one is what stops the previous ply's evaluation and best line appearing under
/// the new position while the restart is in flight. On a remote runner that window is a
/// websocket hop plus the runner's acknowledgement, so it is several frames wide.
///
/// Two things the panel it feeds has to do itself: `LiveLine.pv` is UCI, so the view needs
/// `SAN.line(_:from:limit:)` to make it readable; and `runnerName` is the machine the search
/// is running on, which is the "analysed on ⟨machine⟩" line — nil is **this server**, never
/// unknown.
@Observable
@MainActor
final class LiveEngineStore {

    /// Where the panel is. `.ended` and `.failed` both carry a whole sentence, and both are
    /// the backend's own words wherever it gave any.
    enum Phase: Equatable {
        case off
        /// The POST is in flight, or the search has not sent its first frame yet.
        case opening
        case running
        /// The session stopped for a reason the reader should see. The toggle is already off.
        case ended(String)
        /// The server refused, or a restart failed. Not something to retry into.
        case failed(String)
    }

    /// How many lines to ask for when nothing says otherwise. Three is what the web opens
    /// with: enough to see a choice, few enough to read on a phone.
    nonisolated static let defaultMultipv = 3
    /// One PATCH after the scrubbing settles rather than one per ply.
    nonisolated static let patchDebounce: Duration = .milliseconds(150)

    // MARK: What a view reads

    /// The user's toggle. Never on by default and never remembered: an infinite search is a
    /// thing somebody asked for, not a thing a screen starts on their behalf.
    ///
    /// A computed pair rather than a stored property with `didSet`, so the side effects sit
    /// in a setter that reads the same whether or not `@Observable` has rewritten the
    /// storage underneath it.
    var isOn: Bool {
        get { toggle }
        set {
            guard newValue != toggle else { return }
            toggle = newValue
            if newValue {
                phase = .off
                open()
            } else {
                shutDown()
            }
        }
    }

    private(set) var phase: Phase = .off
    /// The newest accepted frame, in White's frame, or nil while there is nothing to draw.
    private(set) var snapshot: LiveSnapshot?
    /// The engine the search is running on, once the server has said which.
    private(set) var engineName: String?
    /// The machine it is running on. **nil is this server**, not "not known" — a local
    /// engine and a remote one are otherwise indistinguishable on the wire.
    private(set) var runnerName: String?

    /// 1...5. The server refuses anything outside that, so it is clamped here; a change is
    /// a plain PATCH with no debounce, since it is a deliberate tap rather than scrubbing.
    var multipv: Int {
        get { lines }
        set {
            let clamped = min(5, max(1, newValue))
            guard clamped != lines else { return }
            lines = clamped
            guard toggle, let id = sessionID, sentMultipv != clamped else { return }
            sentMultipv = clamped
            patch(id, StreamUpdate(fen: nil, multipv: clamped))
        }
    }

    /// Which engine to open on. Nil takes the one holding the deep tier's role, which is the
    /// normal case and may itself be an engine on a remote runner.
    ///
    /// The engine is the one thing a session cannot be patched onto, so changing it while a
    /// search is running closes the session and opens another.
    var engineID: Int? {
        get { engine }
        set {
            guard newValue != engine else { return }
            engine = newValue
            guard toggle else { return }
            shutDown()
            phase = .off
            open()
        }
    }

    /// The machine's name for the panel's "analysed on ⟨machine⟩" line.
    var hostName: String { runnerName ?? "this server" }

    /// `Stockfish 17 on rig`, or nil before the server has said what it opened on.
    var analysedOn: String? {
        guard let engineName else { return nil }
        return "\(engineName) on \(hostName)"
    }

    /// The position the board is showing, in this app's spelling. Not what frames are
    /// matched against — see `serverFen`.
    private(set) var fen: String?

    /// The request in flight, if any. Not private, so a test can await a round trip instead
    /// of sleeping on a guess about how long one takes.
    private(set) var pending: Task<Void, Never>?

    // MARK: Configuration

    private let surface: StreamSurface
    /// Echoed back on the response; the server does nothing with either.
    private var gameID: Int?
    private var ply: Int?

    // MARK: Internals

    private var toggle = false
    private var lines: Int
    private var engine: Int?

    private var transport: StreamsTransport?
    private var events: EventsFeed?
    private var subscription: EventsSubscription?

    /// The open session. Cleared *before* anything that could delete it, so a session the
    /// server has already buried is never DELETEd a second time.
    private var sessionID: String?
    /// The **server's** spelling of the position the session is on, and the only thing a
    /// frame's FEN can be compared against. Nil exactly while a restart is in flight.
    private var serverFen: String?
    /// The board position the session was last asked to analyse.
    private var sentFen: String?
    private var sentMultipv: Int
    private var lastSeq = -1
    /// Bumped by every open, so an answer to a request nobody is waiting for is dropped.
    private var generation = 0
    /// Bumped by every restart that moves the position, for the same reason.
    private var fenEpoch = 0
    private var debounceTask: Task<Void, Never>?

    init(
        surface: StreamSurface = .game,
        gameID: Int? = nil,
        ply: Int? = nil,
        multipv: Int = LiveEngineStore.defaultMultipv,
        engineID: Int? = nil
    ) {
        self.surface = surface
        self.gameID = gameID
        self.ply = ply
        let clamped = min(5, max(1, multipv))
        lines = clamped
        sentMultipv = clamped
        engine = engineID
    }

    // MARK: Wiring

    /// Give the store its two halves: the REST control and the socket the output rides.
    func attach(transport: StreamsTransport, events: EventsFeed) {
        subscription?.cancel()
        self.transport = transport
        self.events = events
        subscription = events.subscribe { [weak self] signal in
            self?.receive(signal)
        }
    }

    /// The same, for a caller that has a server address rather than a transport.
    func attach(serverURL: URL, events: EventsFeed) {
        attach(transport: StreamsAPI(serverURL: serverURL), events: events)
    }

    /// Let go of the socket and close whatever is open. Call it when the screen goes away —
    /// the server's reaper is the backstop, not the plan.
    func detach() {
        isOn = false
        subscription?.cancel()
        subscription = nil
        events = nil
    }

    // MARK: The toggle

    func start() { isOn = true }
    func stop() { isOn = false }

    // MARK: The position

    /// Move the board. Debounced, because arrow-key scrubbing would otherwise be one
    /// request and one search restart per ply.
    ///
    /// The stored frame is dropped straight away rather than when the answer comes back: a
    /// snapshot of the position we have just left must not sit under the new one for the
    /// length of a round trip.
    func setPosition(_ newFen: String, ply newPly: Int? = nil) {
        if let newPly { ply = newPly }
        guard newFen != fen else { return }
        fen = newFen
        snapshot = nil
        guard toggle else { return }
        guard let id = sessionID else {
            // Nothing open yet — the toggle went on before there was a position to analyse.
            open()
            return
        }
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: LiveEngineStore.patchDebounce)
            guard !Task.isCancelled, let self, self.sessionID == id, let target = self.fen else { return }
            self.lastSeq = -1
            self.sentFen = target
            self.patch(id, StreamUpdate(fen: target, multipv: nil))
        }
    }

    // MARK: Opening and closing

    private func open() {
        guard toggle, sessionID == nil, let transport else { return }
        guard let fen, !fen.isEmpty else {
            // A board with nothing on it. The toggle stays on; the first position opens it.
            phase = .off
            return
        }

        generation += 1
        let mine = generation
        phase = .opening
        snapshot = nil
        lastSeq = -1
        serverFen = nil
        sentFen = fen
        sentMultipv = lines

        let body = StreamCreate(
            fen: fen,
            engineID: engine,
            multipv: lines,
            surface: surface,
            gameID: gameID,
            ply: ply
        )
        pending = Task { [weak self] in
            do {
                let opened = try await transport.open(body)
                guard let self, self.generation == mine, self.toggle else {
                    // Opened by a run nobody is waiting for any more — the toggle flicked,
                    // the engine changed. Closed the moment it exists rather than left for
                    // the reaper to find in thirty seconds.
                    try? await transport.close(opened.id)
                    return
                }
                self.adopt(opened)
            } catch {
                guard let self, self.generation == mine else { return }
                self.refused(error)
            }
        }
    }

    private func adopt(_ opened: StreamResponse) {
        sessionID = opened.id
        serverFen = opened.fen
        engineName = opened.engine
        runnerName = opened.runner

        // What the reader asked for while the POST was in flight. Neither a position nor a
        // line count reopens a session, so both are caught up here rather than left silently
        // unapplied on a search that is already running.
        var catchUp = StreamUpdate()
        if let fen, fen != sentFen {
            sentFen = fen
            catchUp.fen = fen
        }
        if lines != sentMultipv {
            sentMultipv = lines
            catchUp.multipv = lines
        }
        if catchUp.fen != nil || catchUp.multipv != nil {
            patch(opened.id, catchUp)
        }
    }

    /// The server said no, and it means it: every refusal here is immediate and final —
    /// `stream_limit` names the cap this deployment runs with, `stream_unavailable` names
    /// the engine and why. So the sentence is kept verbatim and **the toggle goes back off**.
    /// A refusal is an answer, not something to retry into.
    private func refused(_ error: Error) {
        phase = .failed(LiveEngineStore.sentence(for: error))
        toggle = false
        shutDown()
    }

    /// Everything the toggle leaves behind. Never clears a `.failed` or `.ended` phase: the
    /// reason a search stopped is the one thing the reader still needs after it has.
    private func shutDown() {
        debounceTask?.cancel()
        debounceTask = nil
        // An open still in flight now belongs to nobody, and its session is closed on arrival.
        generation += 1
        let id = sessionID
        sessionID = nil
        serverFen = nil
        sentFen = nil
        lastSeq = -1
        snapshot = nil
        engineName = nil
        runnerName = nil
        switch phase {
        case .failed, .ended: break
        default: phase = .off
        }
        guard let id, let transport else { return }
        pending = Task {
            try? await transport.close(id)
        }
    }

    // MARK: Moving a running session

    /// One PATCH, with the two failures that mean something.
    ///
    /// A patch that **moves the position** blanks the server's FEN for the length of the
    /// round trip, so nothing arriving in that window is drawn: the search is still on the
    /// position the board has left, and every frame in flight carries the old spelling.
    private func patch(_ id: String, _ body: StreamUpdate) {
        guard let transport else { return }
        let moves = body.movesPosition
        if moves {
            serverFen = nil
            fenEpoch += 1
        }
        let epoch = fenEpoch
        pending = Task { [weak self] in
            do {
                let updated = try await transport.update(id, body)
                guard let self, self.sessionID == id else { return }
                // A newer restart has already gone out: this answer describes a position the
                // session has left again, and taking its FEN would reopen the window above.
                guard epoch == self.fenEpoch else { return }
                self.serverFen = updated.fen
                self.engineName = updated.engine
                self.runnerName = updated.runner
            } catch {
                guard let self, self.sessionID == id else { return }
                // `unknown_stream` — the only 404 this route has, so the status is the whole
                // test. The session was reaped under us; drop it and open another rather
                // than leave lines from a search that no longer exists on screen.
                if let apiError = error as? APIError, case .notFound = apiError {
                    self.sessionID = nil
                    self.serverFen = nil
                    self.open()
                    return
                }
                // A refused *restart* is the one that has to reach the reader: the search is
                // stuck on a position the board has left, so without it the panel sits on
                // stale rows with the backend's reason unsaid.
                if moves, epoch == self.fenEpoch {
                    self.phase = .failed(LiveEngineStore.sentence(for: error))
                }
            }
        }
    }

    // MARK: The socket

    private func receive(_ signal: EventsSignal) {
        switch signal {
        case let .connected(afterDrop):
            if afterDrop { verifySession() }
        case .disconnected, .unauthorized:
            // Neither is this store's to act on. A drop reconnects by itself, and a refused
            // cookie is `Session`'s business — it signs the whole app out.
            break
        case let .stream(event):
            apply(event)
        }
    }

    private func apply(_ event: StreamEvent) {
        switch event {
        case let .started(started):
            guard started.sessionID == sessionID else { return }
            engineName = started.engine
            runnerName = started.runner
        case let .snapshot(frame):
            guard LiveEngineStore.accepts(
                frame,
                sessionID: sessionID,
                lastSeq: lastSeq,
                serverFen: serverFen
            ) else { return }
            lastSeq = frame.seq
            snapshot = LiveSnapshot(frame)
            phase = .running
        case let .ended(finished):
            guard finished.sessionID == sessionID else { return }
            end(finished)
        }
    }

    /// Whether a frame describes the search this store is showing.
    ///
    /// Pulled out as a pure function because it is the whole correctness of the panel and
    /// the one thing worth testing without a socket: each of the three clauses fails in a
    /// way that looks entirely plausible on screen — another board's lines, a frame that
    /// arrived late, or the previous ply's evaluation under the new position.
    static func accepts(
        _ frame: StreamSnapshotEvent,
        sessionID: String?,
        lastSeq: Int,
        serverFen: String?
    ) -> Bool {
        guard let sessionID, frame.sessionID == sessionID else { return false }
        guard frame.seq > lastSeq else { return false }
        guard let serverFen, frame.fen == serverFen else { return false }
        return true
    }

    /// The session is gone. The id is cleared **first**, so the teardown below finds nothing
    /// to DELETE — the server has already buried it and would answer 404.
    private func end(_ finished: StreamEndedEvent) {
        sessionID = nil
        serverFen = nil
        sentFen = nil
        snapshot = nil
        lastSeq = -1
        if finished.reason.isQuiet {
            phase = .off
        } else {
            phase = .ended(finished.reason.message(error: finished.error))
        }
        toggle = false
        shutDown()
    }

    /// Nothing is replayed on `/events`, so a session may have been reaped while the socket
    /// was down. `GET /streams` is the only way to tell, and it is asked once per reconnect
    /// rather than on a timer.
    private func verifySession() {
        guard toggle, let id = sessionID, let transport else { return }
        pending = Task { [weak self] in
            guard let open = try? await transport.list() else {
                // The socket is back but the API is not answering yet. The next reconnect
                // asks again, and the panel still has the last frame it had.
                return
            }
            guard let self, self.sessionID == id else { return }
            guard !open.contains(where: { $0.id == id }) else { return }
            self.sessionID = nil
            self.serverFen = nil
            self.open()
        }
    }

    /// The backend's own sentence wherever there is one. `APIError` is a `LocalizedError`
    /// whose description for a refusal is the server's `detail` verbatim, which says more
    /// than anything that could be written here — `stream_limit` names the configured cap,
    /// `stream_unavailable` names the engine.
    private static func sentence(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
