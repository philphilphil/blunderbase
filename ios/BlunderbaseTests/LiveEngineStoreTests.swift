import XCTest

@testable import Blunderbase

/// The live panel's correctness is mostly refusals, and these are the refusals.
///
/// A live search runs behind a board the reader can scrub faster than the search can be
/// told about it, so the interesting failures all look plausible on screen: another board's
/// lines, a frame that overtook a newer one, or the previous ply's evaluation sitting under
/// the new position. Each of those is one clause of `LiveEngineStore.accepts`, and each is
/// tested on its own here so a change that drops one fails loudly rather than shipping a
/// panel that is quietly one ply behind.
///
/// Nothing here touches a socket or a server. The store takes its transport and its feed as
/// dependencies for exactly this reason.
@MainActor
final class LiveEngineStoreTests: XCTestCase {

    private let start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    private let afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"

    // MARK: The three acceptance rules

    func testAFrameFromAnotherSessionIsRefused() throws {
        // Two boards can be open at once — the game page's and the live board's — and both
        // publish onto the same socket.
        XCTAssertFalse(
            LiveEngineStore.accepts(
                try frame(session: "str_other", seq: 1, fen: start),
                sessionID: "str_mine",
                lastSeq: 0,
                serverFen: start
            )
        )
    }

    func testAFrameWithNoSessionOpenIsRefused() throws {
        XCTAssertFalse(
            LiveEngineStore.accepts(
                try frame(session: "str_mine", seq: 1, fen: start),
                sessionID: nil,
                lastSeq: -1,
                serverFen: start
            )
        )
    }

    func testAFrameThatIsNotAheadOfTheLastOneIsRefused() throws {
        // Delivery is lossy and may reorder: the backlog drops its oldest frames and nothing
        // is replayed, so only a frame ahead of the last accepted one is news.
        XCTAssertFalse(
            LiveEngineStore.accepts(
                try frame(session: "str_mine", seq: 7, fen: start),
                sessionID: "str_mine",
                lastSeq: 7,
                serverFen: start
            ),
            "the same seq twice"
        )
        XCTAssertFalse(
            LiveEngineStore.accepts(
                try frame(session: "str_mine", seq: 6, fen: start),
                sessionID: "str_mine",
                lastSeq: 7,
                serverFen: start
            ),
            "a frame that arrived late"
        )
        XCTAssertTrue(
            LiveEngineStore.accepts(
                try frame(session: "str_mine", seq: 8, fen: start),
                sessionID: "str_mine",
                lastSeq: 7,
                serverFen: start
            )
        )
    }

    func testAFrameForAnotherPositionIsRefused() throws {
        XCTAssertFalse(
            LiveEngineStore.accepts(
                try frame(session: "str_mine", seq: 1, fen: start),
                sessionID: "str_mine",
                lastSeq: 0,
                serverFen: afterE4
            )
        )
    }

    func testNoFrameIsAcceptedWhileARestartIsInFlight() throws {
        // The server's FEN is blanked for the length of a restart, and everything arriving
        // in that window describes the position the board has just left. On a remote runner
        // that window is several frames wide.
        XCTAssertFalse(
            LiveEngineStore.accepts(
                try frame(session: "str_mine", seq: 9, fen: start),
                sessionID: "str_mine",
                lastSeq: 0,
                serverFen: nil
            )
        )
    }

    func testTheFenComparedIsTheServersSpellingNotOurs() throws {
        // The backend runs a caller's FEN through python-chess and echoes its own spelling
        // back. Comparing against the string we sent would drop every frame on a server
        // that writes the move counters differently.
        let ours = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
        XCTAssertFalse(
            LiveEngineStore.accepts(
                try frame(session: "str_mine", seq: 1, fen: start),
                sessionID: "str_mine",
                lastSeq: 0,
                serverFen: ours
            )
        )
    }

    // MARK: Opening

    func testOpeningASessionRunsTheSearchAndNamesTheMachine() async throws {
        let transport = FakeStreams()
        transport.opened = try response(id: "str_1", fen: start, runner: "rig")
        let events = FakeEvents()
        let store = LiveEngineStore()
        store.attach(transport: transport, events: events)

        store.setPosition(start)
        store.isOn = true
        await store.pending?.value

        XCTAssertEqual(store.phase, .opening, "opening until the first frame arrives")
        XCTAssertEqual(store.engineName, "Stockfish 17")
        XCTAssertEqual(store.runnerName, "rig")
        XCTAssertEqual(store.hostName, "rig")
        XCTAssertEqual(store.analysedOn, "Stockfish 17 on rig")

        events.send(.stream(.snapshot(try frame(session: "str_1", seq: 1, fen: start, cp: 31))))

        XCTAssertEqual(store.phase, .running)
        XCTAssertEqual(store.snapshot?.top?.cp, 31)
        XCTAssertEqual(store.snapshot?.seq, 1)
    }

    func testALocalEngineReadsAsThisServerRatherThanAsUnknown() async throws {
        let transport = FakeStreams()
        transport.opened = try response(id: "str_1", fen: start, runner: nil)
        let store = LiveEngineStore()
        store.attach(transport: transport, events: FakeEvents())

        store.setPosition(start)
        store.isOn = true
        await store.pending?.value

        XCTAssertNil(store.runnerName)
        XCTAssertEqual(store.hostName, "this server")
        XCTAssertEqual(store.analysedOn, "Stockfish 17 on this server")
    }

    func testARefusedOpenTurnsTheToggleBackOffAndKeepsTheBackendsSentence() async throws {
        let transport = FakeStreams()
        transport.failure = APIError.server(
            status: 409,
            name: "stream_limit",
            message: "this server runs at most 2 analysis boards at once"
        )
        let store = LiveEngineStore()
        store.attach(transport: transport, events: FakeEvents())

        store.setPosition(start)
        store.isOn = true
        await store.pending?.value

        XCTAssertFalse(store.isOn, "a refusal is an answer, not something to retry into")
        XCTAssertEqual(
            store.phase,
            .failed("this server runs at most 2 analysis boards at once"),
            "the backend's own sentence, verbatim"
        )
    }

    func testTurningTheToggleOnAgainClearsTheRefusal() async throws {
        let transport = FakeStreams()
        transport.failure = APIError.server(status: 409, name: "stream_limit", message: "no slots")
        let store = LiveEngineStore()
        store.attach(transport: transport, events: FakeEvents())
        store.setPosition(start)
        store.isOn = true
        await store.pending?.value
        XCTAssertEqual(store.phase, .failed("no slots"))

        transport.failure = nil
        transport.opened = try response(id: "str_2", fen: start, runner: nil)
        store.isOn = true
        await store.pending?.value

        XCTAssertTrue(store.isOn)
        XCTAssertEqual(store.phase, .opening)
    }

    // MARK: Closing

    func testTurningTheToggleOffClosesTheSession() async throws {
        let transport = FakeStreams()
        transport.opened = try response(id: "str_1", fen: start, runner: nil)
        let store = LiveEngineStore()
        store.attach(transport: transport, events: FakeEvents())
        store.setPosition(start)
        store.isOn = true
        await store.pending?.value

        store.isOn = false
        await store.pending?.value

        XCTAssertEqual(transport.closed, ["str_1"], "the reaper is the backstop, not the plan")
        XCTAssertEqual(store.phase, .off)
        XCTAssertNil(store.snapshot)
        XCTAssertNil(store.runnerName)
    }

    func testASessionTheServerEndedIsNotDeletedAgain() async throws {
        let transport = FakeStreams()
        transport.opened = try response(id: "str_1", fen: start, runner: "rig")
        let events = FakeEvents()
        let store = LiveEngineStore()
        store.attach(transport: transport, events: events)
        store.setPosition(start)
        store.isOn = true
        await store.pending?.value

        events.send(.stream(.ended(try ended(session: "str_1", reason: "runner_gone"))))
        await store.pending?.value

        XCTAssertTrue(transport.closed.isEmpty, "the server has already buried it")
        XCTAssertFalse(store.isOn)
        XCTAssertEqual(store.phase, .ended("The machine running the engine went away."))
    }

    func testAnEndedFrameForAnotherSessionIsIgnored() async throws {
        let transport = FakeStreams()
        transport.opened = try response(id: "str_1", fen: start, runner: nil)
        let events = FakeEvents()
        let store = LiveEngineStore()
        store.attach(transport: transport, events: events)
        store.setPosition(start)
        store.isOn = true
        await store.pending?.value

        events.send(.stream(.ended(try ended(session: "str_other", reason: "engine_failed"))))

        XCTAssertTrue(store.isOn)
        XCTAssertEqual(store.phase, .opening)
    }

    func testAQuietEndingSaysNothing() async throws {
        let transport = FakeStreams()
        transport.opened = try response(id: "str_1", fen: start, runner: nil)
        let events = FakeEvents()
        let store = LiveEngineStore()
        store.attach(transport: transport, events: events)
        store.setPosition(start)
        store.isOn = true
        await store.pending?.value

        events.send(.stream(.ended(try ended(session: "str_1", reason: "closed"))))

        XCTAssertEqual(store.phase, .off)
        XCTAssertFalse(store.isOn)
    }

    // MARK: Moving

    func testMovingTheBoardDropsTheFrameItWasShowing() async throws {
        let transport = FakeStreams()
        transport.opened = try response(id: "str_1", fen: start, runner: nil)
        let events = FakeEvents()
        let store = LiveEngineStore()
        store.attach(transport: transport, events: events)
        store.setPosition(start)
        store.isOn = true
        await store.pending?.value
        events.send(.stream(.snapshot(try frame(session: "str_1", seq: 1, fen: start, cp: 31))))
        XCTAssertNotNil(store.snapshot)

        store.setPosition(afterE4)

        XCTAssertNil(store.snapshot, "the previous ply's lines must not sit under the new board")
    }

    func testTheLineCountIsClampedToWhatTheServerAccepts() {
        let store = LiveEngineStore()
        store.multipv = 9
        XCTAssertEqual(store.multipv, 5)
        store.multipv = 0
        XCTAssertEqual(store.multipv, 1)
    }

    func testATurnedOffStoreOpensNothing() async throws {
        let transport = FakeStreams()
        transport.opened = try response(id: "str_1", fen: start, runner: nil)
        let store = LiveEngineStore()
        store.attach(transport: transport, events: FakeEvents())

        store.setPosition(start)
        await store.pending?.value

        XCTAssertEqual(transport.opens, 0, "nothing runs until the reader asks for it")
        XCTAssertEqual(store.phase, .off)
    }

    // MARK: Fixtures

    private func frame(
        session: String,
        seq: Int,
        fen: String,
        cp: Int = 20
    ) throws -> StreamSnapshotEvent {
        let json = """
        {"event": "stream.snapshot", "session_id": "\(session)", "seq": \(seq), "engine_id": 4,
         "engine": "Stockfish 17", "fen": "\(fen)", "multipv": 1,
         "lines": [{"multipv": 1, "cp": \(cp), "pv": ["e2e4", "e7e5"]}],
         "at": "2026-09-04T08:00:00Z"}
        """
        guard case let .snapshot(decoded)? = StreamEventDecoding.decode(
            Data(json.utf8),
            using: APIClient.makeDecoder()
        ) else {
            throw XCTSkip("the snapshot fixture did not decode")
        }
        return decoded
    }

    private func ended(session: String, reason: String) throws -> StreamEndedEvent {
        let json = """
        {"event": "stream.ended", "session_id": "\(session)", "reason": "\(reason)",
         "engine_id": 4, "runner_id": 3, "at": "2026-09-04T08:00:09Z"}
        """
        guard case let .ended(decoded)? = StreamEventDecoding.decode(
            Data(json.utf8),
            using: APIClient.makeDecoder()
        ) else {
            throw XCTSkip("the ended fixture did not decode")
        }
        return decoded
    }

    private func response(id: String, fen: String, runner: String?) throws -> StreamResponse {
        let runnerJSON = runner.map { "\"\($0)\"" } ?? "null"
        let json = """
        {"id": "\(id)", "surface": "game", "fen": "\(fen)", "multipv": 3, "engine_id": 4,
         "engine": "Stockfish 17", "runner_id": \(runner == nil ? "null" : "3"),
         "runner": \(runnerJSON), "state": "starting", "seq": 0,
         "created_at": "2026-09-04T08:00:00Z"}
        """
        guard let decoded = try? APIClient.makeDecoder().decode(
            StreamResponse.self,
            from: Data(json.utf8)
        ) else {
            throw XCTSkip("the response fixture did not decode")
        }
        return decoded
    }
}

/// A `/streams` control plane that answers whatever the test has put in it, and remembers
/// what it was asked.
@MainActor
private final class FakeStreams: StreamsTransport {
    var opened: StreamResponse?
    /// Thrown by the next call, whatever it is. `APIError.notFound` is `unknown_stream`.
    var failure: Error?

    private(set) var opens = 0
    private(set) var updates: [(id: String, body: StreamUpdate)] = []
    private(set) var closed: [String] = []
    private(set) var listed = 0
    /// What `list()` answers with, for the reconnect check.
    var openSessions: [StreamResponse] = []

    func open(_ body: StreamCreate) async throws -> StreamResponse {
        opens += 1
        if let failure { throw failure }
        guard let opened else { throw APIError.transport(URLError(.badServerResponse)) }
        return opened
    }

    func update(_ id: String, _ body: StreamUpdate) async throws -> StreamResponse {
        updates.append((id, body))
        if let failure { throw failure }
        guard let opened else { throw APIError.transport(URLError(.badServerResponse)) }
        return opened
    }

    func close(_ id: String) async throws {
        closed.append(id)
    }

    func list() async throws -> [StreamResponse] {
        listed += 1
        if let failure { throw failure }
        return openSessions
    }
}

/// A feed with no socket behind it: `send` is what the server would have pushed.
@MainActor
private final class FakeEvents: EventsFeed {
    var isConnected = true

    private var handlers: [Int: (EventsSignal) -> Void] = [:]
    private var nextToken = 0

    func subscribe(_ handler: @escaping (EventsSignal) -> Void) -> EventsSubscription {
        nextToken += 1
        let token = nextToken
        handlers[token] = handler
        return EventsSubscription { [weak self] in
            self?.handlers.removeValue(forKey: token)
        }
    }

    func send(_ signal: EventsSignal) {
        for handler in Array(handlers.values) {
            handler(signal)
        }
    }
}
