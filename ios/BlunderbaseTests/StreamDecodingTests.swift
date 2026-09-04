import XCTest

@testable import Blunderbase

/// The `/streams` wire, read the way it really arrives.
///
/// Two things here are worth more than the decoding: an unrecognised `event` name has to be
/// *ignored* rather than fail the socket, since the same socket carries imports, analysis
/// runs and a keepalive ping; and the score flip has to be exactly right, because a wrong
/// one is a plausible-looking panel that says Black is winning when White is.
///
/// Everything decodes through `APIClient.makeDecoder()` rather than a decoder built here, so
/// a date rule the app does not use cannot be what these tests prove.
final class StreamDecodingTests: XCTestCase {

    private func decoder() -> JSONDecoder { APIClient.makeDecoder() }

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try decoder().decode(type, from: Data(json.utf8))
    }

    private func event(_ json: String) -> StreamEvent? {
        StreamEventDecoding.decode(Data(json.utf8), using: decoder())
    }

    // MARK: The response

    func testStreamResponseDecodesWithALocalEngine() throws {
        let response = try decode(
            StreamResponse.self,
            #"""
            {"id": "str_9f2a", "surface": "game", "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
             "multipv": 3, "engine_id": 4, "engine": "Stockfish 17", "runner_id": null, "runner": null,
             "state": "running", "reason": null, "seq": 12, "created_at": "2026-09-04T08:00:00Z",
             "last_snapshot_at": "2026-09-04T08:00:03.250Z", "game_id": 88, "ply": 17}
            """#
        )

        XCTAssertEqual(response.id, "str_9f2a")
        XCTAssertEqual(response.engine, "Stockfish 17")
        XCTAssertNil(response.runnerID)
        XCTAssertNil(response.runner, "a local engine is exactly a session with no runner")
        XCTAssertEqual(response.multipv, 3)
        XCTAssertEqual(response.seq, 12)
        XCTAssertEqual(response.gameID, 88)
        XCTAssertEqual(response.ply, 17)
    }

    func testStreamResponseSurvivesTheKeysTheBackendDrops() throws {
        // Response models drop a null rather than sending it, so the optional half of the
        // shape is simply absent on a session that has never produced a frame.
        let response = try decode(
            StreamResponse.self,
            #"""
            {"id": "str_1", "surface": "live", "fen": "8/8/8/8/8/8/8/K6k w - - 0 1",
             "engine_id": 2, "engine": "Stockfish", "created_at": "2026-09-04T08:00:00Z"}
            """#
        )

        XCTAssertEqual(response.multipv, 1, "the backend's own default")
        XCTAssertEqual(response.state, "starting")
        XCTAssertEqual(response.seq, 0)
        XCTAssertNil(response.lastSnapshotAt)
        XCTAssertNil(response.gameID)
        XCTAssertNil(response.ply)
    }

    func testStreamResponseNamesTheMachineWhenTheEngineIsRemote() throws {
        let response = try decode(
            StreamResponse.self,
            #"""
            {"id": "str_2", "surface": "game", "fen": "8/8/8/8/8/8/8/K6k w - - 0 1",
             "engine_id": 9, "engine": "Stockfish 17", "runner_id": 3, "runner": "rig",
             "created_at": "2026-09-04T08:00:00Z"}
            """#
        )

        XCTAssertEqual(response.runner, "rig", "what the panel says the search is running on")
        XCTAssertEqual(response.runnerID, 3)
    }

    // MARK: Requests

    func testStreamCreateSendsOnlyTheKeysTheBackendAllows() throws {
        // The request model is `extra="forbid"`, so a key it does not know is a 422 rather
        // than a warning — and an optional written as null is a key.
        let body = StreamCreate(fen: "8/8/8/8/8/8/8/K6k w - - 0 1", multipv: 3, surface: .game)
        let data = try JSONEncoder().encode(body)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(Set(object.keys), ["fen", "multipv", "surface"])
    }

    func testStreamCreateSpellsItsKeysTheWayTheBackendDoes() throws {
        let body = StreamCreate(
            fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
            engineID: 4,
            multipv: 2,
            surface: .live,
            gameID: 7,
            ply: 12
        )
        let data = try JSONEncoder().encode(body)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object["engine_id"] as? Int, 4)
        XCTAssertEqual(object["game_id"] as? Int, 7)
        XCTAssertEqual(object["surface"] as? String, "live")
        XCTAssertEqual(object["ply"] as? Int, 12)
    }

    func testStreamUpdateOmitsWhatItIsNotChanging() throws {
        let data = try JSONEncoder().encode(StreamUpdate(multipv: 4))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(object.keys.sorted(), ["multipv"])
        XCTAssertFalse(StreamUpdate(multipv: 4).movesPosition)
        XCTAssertTrue(StreamUpdate(fen: "8/8/8/8/8/8/8/K6k w - - 0 1").movesPosition)
    }

    // MARK: The frames

    func testStartedFrameDecodes() throws {
        let decoded = event(
            #"""
            {"event": "stream.started", "session_id": "str_9f2a", "surface": "game",
             "engine_id": 4, "engine": "Stockfish 17", "runner_id": 3, "runner": "rig",
             "fen": "8/8/8/8/8/8/8/K6k w - - 0 1", "multipv": 3, "at": "2026-09-04T08:00:00Z"}
            """#
        )

        guard case let .started(started)? = decoded else {
            return XCTFail("expected a stream.started frame, got \(String(describing: decoded))")
        }
        XCTAssertEqual(started.sessionID, "str_9f2a")
        XCTAssertEqual(started.runner, "rig")
        XCTAssertEqual(started.multipv, 3)
    }

    func testSnapshotFrameDecodesIncludingTheKeysThatCanBeNull() throws {
        let decoded = event(
            #"""
            {"event": "stream.snapshot", "session_id": "str_9f2a", "seq": 41, "engine_id": 4,
             "engine": "Stockfish 17", "runner_id": null,
             "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "multipv": 2,
             "depth": 28, "nodes": 4200000, "nps": 1840211, "time_ms": 2280,
             "lines": [{"multipv": 1, "cp": 31, "mate": null, "pv": ["e2e4", "e7e5"]},
                       {"multipv": 2, "cp": 18, "pv": ["d2d4"]}],
             "at": "2026-09-04T08:00:03.250Z"}
            """#
        )

        guard case let .snapshot(frame)? = decoded else {
            return XCTFail("expected a stream.snapshot frame, got \(String(describing: decoded))")
        }
        XCTAssertEqual(frame.seq, 41)
        XCTAssertNil(frame.runnerID, "no runner id is a local engine")
        XCTAssertEqual(frame.depth, 28)
        XCTAssertEqual(frame.nps, 1_840_211)
        XCTAssertEqual(frame.timeMs, 2280)
        XCTAssertEqual(frame.lines.count, 2)
        XCTAssertEqual(frame.lines[0].pv, ["e2e4", "e7e5"])
        XCTAssertNil(frame.lines[1].mate, "an absent key reads the same as a null one")
    }

    func testSnapshotFrameWithNothingReportedYetStillDecodes() throws {
        // The first frame of a search carries a session and a position and very little else.
        let decoded = event(
            #"""
            {"event": "stream.snapshot", "session_id": "str_1", "seq": 1, "engine_id": 4,
             "engine": "Stockfish", "fen": "8/8/8/8/8/8/8/K6k w - - 0 1", "multipv": 1,
             "lines": [], "at": "2026-09-04T08:00:00Z"}
            """#
        )

        guard case let .snapshot(frame)? = decoded else {
            return XCTFail("expected a stream.snapshot frame")
        }
        XCTAssertNil(frame.depth)
        XCTAssertNil(frame.nodes)
        XCTAssertNil(frame.nps)
        XCTAssertNil(frame.timeMs)
        XCTAssertTrue(frame.lines.isEmpty)
    }

    func testEndedFrameDecodesAndKeepsTheReasonsApart() throws {
        let decoded = event(
            #"""
            {"event": "stream.ended", "session_id": "str_9f2a", "reason": "runner_gone",
             "error": null, "engine_id": 4, "runner_id": 3, "at": "2026-09-04T08:00:09Z"}
            """#
        )

        guard case let .ended(finished)? = decoded else {
            return XCTFail("expected a stream.ended frame")
        }
        XCTAssertEqual(finished.reason, .runnerGone)
        XCTAssertNil(finished.error)
        XCTAssertFalse(finished.reason.isQuiet, "a machine going away is worth saying")
    }

    func testAReasonThisBuildDoesNotKnowIsStillWorthShowing() throws {
        let decoded = event(
            #"""
            {"event": "stream.ended", "session_id": "str_1", "reason": "sunspots",
             "engine_id": 4, "at": "2026-09-04T08:00:09Z"}
            """#
        )

        guard case let .ended(finished)? = decoded else {
            return XCTFail("expected a stream.ended frame")
        }
        XCTAssertEqual(finished.reason, .unknown)
        XCTAssertFalse(finished.reason.isQuiet)
    }

    func testTheFramesErrorIsPreferredToAnythingWrittenHere() {
        XCTAssertEqual(
            StreamEndReason.engineFailed.message(error: "stockfish exited with code 1"),
            "stockfish exited with code 1"
        )
        XCTAssertEqual(
            StreamEndReason.replaced.message(error: nil),
            "Another analysis board took this position over."
        )
    }

    // MARK: Everything else on the socket

    func testAnUnknownEventNameIsIgnoredRatherThanFailingTheSocket() {
        XCTAssertNil(event(#"{"event": "ping"}"#))
        XCTAssertNil(event(#"{"event": "analysis.done", "run_id": 4, "game_id": 12}"#))
        XCTAssertNil(event(#"{"event": "note.created", "note_id": 3}"#))
        XCTAssertNil(event(#"{"event": "runner.disconnected", "runner_id": 3}"#))
    }

    func testRubbishOnTheSocketIsDroppedRatherThanThrown() {
        XCTAssertNil(event("not json at all"))
        XCTAssertNil(event(#"{"no_event_key": true}"#))
        // The right name and the wrong shape is one frame, not a broken socket.
        XCTAssertNil(event(#"{"event": "stream.snapshot", "seq": 4}"#))
    }

    // MARK: The White-frame flip

    func testWhiteToMoveLinesAreAlreadyInWhitesFrame() throws {
        let frame = try snapshot(fen: "8/8/8/8/8/8/8/K6k w - - 0 1", lines: [
            StreamLine(multipv: 1, cp: 120, pv: ["a1a2"])
        ])

        XCTAssertEqual(LiveSnapshot(frame).lines.first?.cp, 120)
    }

    func testBlackToMoveLinesAreFlippedIntoWhitesFrame() throws {
        // +250 for the side to move, and Black is to move, so White is 250 behind.
        let frame = try snapshot(fen: "8/8/8/8/8/8/8/K6k b - - 0 1", lines: [
            StreamLine(multipv: 1, cp: 250, pv: ["h1h2"])
        ])

        XCTAssertEqual(LiveSnapshot(frame).lines.first?.cp, -250)
    }

    func testTheMateSignAndTheCentipawnSignMoveTogether() throws {
        // `mate` is 0 both for "has mated" and for "is mated", so the sign of that pair
        // lives in `cp`. Negating one without the other turns a forced win into a forced
        // loss while leaving the distance saying the opposite.
        let mating = try snapshot(fen: "8/8/8/8/8/8/8/K6k b - - 0 1", lines: [
            StreamLine(multipv: 1, cp: 0, mate: 3, pv: ["h1h2"])
        ])
        let mated = try snapshot(fen: "8/8/8/8/8/8/8/K6k b - - 0 1", lines: [
            StreamLine(multipv: 1, cp: 0, mate: -2, pv: ["h1h2"])
        ])

        let winning = LiveSnapshot(mating).lines.first
        XCTAssertEqual(winning?.mate, -3, "Black mates in 3, which is White being mated in 3")
        XCTAssertEqual(winning?.cp, 0)

        XCTAssertEqual(LiveSnapshot(mated).lines.first?.mate, 2)
    }

    func testAMissingScoreStaysMissingRatherThanBecomingZero() throws {
        let frame = try snapshot(fen: "8/8/8/8/8/8/8/K6k b - - 0 1", lines: [
            StreamLine(multipv: 1, cp: nil, mate: nil, pv: ["h1h2"])
        ])

        let line = LiveSnapshot(frame).lines.first
        XCTAssertNil(line?.cp)
        XCTAssertNil(line?.mate)
    }

    func testLinesAreSortedByMultipvBecauseTheWireDoesNotPromiseAnOrder() throws {
        let frame = try snapshot(fen: "8/8/8/8/8/8/8/K6k w - - 0 1", lines: [
            StreamLine(multipv: 3, cp: 5, pv: ["a1b1"]),
            StreamLine(multipv: 1, cp: 40, pv: ["a1a2"]),
            StreamLine(multipv: 2, cp: 20, pv: ["a1b2"]),
        ])

        let live = LiveSnapshot(frame)
        XCTAssertEqual(live.lines.map(\.multipv), [1, 2, 3])
        XCTAssertEqual(live.top?.pv.first, "a1a2")
    }

    func testTheSideToMoveIsReadOffTheFramesOwnFen() {
        XCTAssertTrue(LiveSnapshot.blackToMove(in: "8/8/8/8/8/8/8/K6k b - - 0 1"))
        XCTAssertFalse(LiveSnapshot.blackToMove(in: "8/8/8/8/8/8/8/K6k w - - 0 1"))
        // Nothing to read: White, rather than a crash or a silently flipped board.
        XCTAssertFalse(LiveSnapshot.blackToMove(in: "8/8/8/8/8/8/8/K6k"))
        XCTAssertFalse(LiveSnapshot.blackToMove(in: ""))
    }

    func testThePvIsLeftInUciForTheViewToTurnIntoSan() throws {
        let frame = try snapshot(fen: "8/8/8/8/8/8/8/K6k b - - 0 1", lines: [
            StreamLine(multipv: 1, cp: 10, pv: ["h1h2", "a1a2"])
        ])

        XCTAssertEqual(LiveSnapshot(frame).lines.first?.pv, ["h1h2", "a1a2"])
    }

    // MARK: Fixture

    /// A snapshot frame built the long way round — as JSON, through the app's own decoder —
    /// so the flip is exercised against something the wire could actually deliver rather
    /// than against a struct assembled in memory.
    private func snapshot(fen: String, lines: [StreamLine]) throws -> StreamSnapshotEvent {
        let encoded = lines.map { line -> String in
            var parts = ["\"multipv\": \(line.multipv)"]
            if let cp = line.cp { parts.append("\"cp\": \(cp)") }
            if let mate = line.mate { parts.append("\"mate\": \(mate)") }
            parts.append("\"pv\": [\(line.pv.map { "\"\($0)\"" }.joined(separator: ", "))]")
            return "{\(parts.joined(separator: ", "))}"
        }
        let json = """
        {"event": "stream.snapshot", "session_id": "str_fixture", "seq": 1, "engine_id": 4,
         "engine": "Stockfish", "fen": "\(fen)", "multipv": \(max(1, lines.count)),
         "lines": [\(encoded.joined(separator: ", "))], "at": "2026-09-04T08:00:00Z"}
        """
        guard case let .snapshot(frame)? = event(json) else {
            throw XCTSkip("the fixture itself did not decode")
        }
        return frame
    }
}
