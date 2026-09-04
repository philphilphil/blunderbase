import Foundation

/// The `/streams` vocabulary: what the phone sends to open an analysis board, what the
/// server answers with, and the three frames the board's output arrives on.
///
/// Live analysis is split across two transports, and that split is the reason this file
/// exists apart from `Models.swift`. **Control is REST** — open, move, close — and **output
/// is the `/events` socket**, at about two frames a second. Nothing here talks to either
/// one; these are the shapes both halves agree on.
///
/// Three things about the wire shape every consumer has to know:
///
/// - **The server owns the FEN's spelling.** `services/streams.py` runs a caller's FEN
///   through python-chess and echoes *its* spelling back, on the response and on every
///   frame. So a frame is matched against the FEN the server said, never the one we sent.
/// - **Delivery is lossy.** A client that falls behind has its oldest frames dropped and
///   nothing is replayed, which is what `seq` is for.
/// - **Scores are from the side to move's point of view**, and everything else this app
///   draws is White-relative. `LiveSnapshot` is where that is undone, once.

// MARK: - Requests

/// Which board a session belongs to. One session per surface, server-side, so opening a
/// second `game` board anywhere replaces the first — which is what `replaced` means on the
/// way out. The phone opens `companion`, its own surface, so it never evicts a browser
/// sitting on the same game.
enum StreamSurface: String, Codable, Sendable, Equatable {
    case game
    case live
    case companion
}

/// `POST /streams`.
///
/// The backend's request model is `extra="forbid"`, so a key it does not know is a 422 and
/// not a warning. Swift omits a nil `Optional` rather than writing `null`, which is exactly
/// what is wanted here — every optional below means "let the server decide" when absent.
struct StreamCreate: Encodable, Sendable, Equatable {
    var fen: String
    /// Absent takes the engine holding the deep tier's role, which may itself live on a
    /// remote runner. That is the normal case; a picker is what would set this.
    var engineID: Int?
    /// 1...5. The server refuses anything else, so a caller clamps rather than discovers.
    var multipv: Int = 1
    var surface: StreamSurface = .game
    /// Echoed back untouched, so a page can tell which board a session belongs to.
    var gameID: Int?
    var ply: Int?

    enum CodingKeys: String, CodingKey {
        case fen
        case engineID = "engine_id"
        case multipv
        case surface
        case gameID = "game_id"
        case ply
    }
}

/// `PATCH /streams/{id}` — the two things a session can be moved onto without a teardown.
///
/// The engine is deliberately not among them: changing engines is a `DELETE` and a `POST`,
/// because the search has to start over on another process anyway.
struct StreamUpdate: Encodable, Sendable, Equatable {
    var fen: String?
    var multipv: Int?

    /// Whether this patch moves the position, which is the case a caller has to treat
    /// differently: until the server answers, every frame still arriving describes the
    /// position the board has just left.
    var movesPosition: Bool { fen != nil }
}

// MARK: - Responses

/// One open analysis board, as the server describes it.
///
/// `runner == nil` is a local engine, and that is the *only* thing that distinguishes the
/// two — the frames are identical either way. It is also the fact the panel is built to
/// say out loud, so it is carried rather than collapsed into a boolean.
struct StreamResponse: Decodable, Sendable, Equatable {
    let id: String
    let surface: String
    /// The server's own spelling of the position, which is what frames must be matched
    /// against. Never assume it equals the FEN that was sent.
    let fen: String
    let multipv: Int
    let engineID: Int
    let engine: String
    let runnerID: Int?
    /// The machine the search is running on; nil means this server's own engine.
    let runner: String?
    /// `starting`, `running` or `ended`.
    let state: String
    let reason: String?
    let seq: Int
    let createdAt: Date
    let lastSnapshotAt: Date?
    let gameID: Int?
    let ply: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case surface
        case fen
        case multipv
        case engineID = "engine_id"
        case engine
        case runnerID = "runner_id"
        case runner
        case state
        case reason
        case seq
        case createdAt = "created_at"
        case lastSnapshotAt = "last_snapshot_at"
        case gameID = "game_id"
        case ply
    }

    /// Hand-written for the fields the backend gives a default rather than always sending.
    /// Response models drop a null key instead of writing it (`Models.swift` opens on this),
    /// so a value that happens to equal its default may not be on the wire at all.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        surface = try container.decodeIfPresent(String.self, forKey: .surface) ?? StreamSurface.game.rawValue
        fen = try container.decode(String.self, forKey: .fen)
        multipv = try container.decodeIfPresent(Int.self, forKey: .multipv) ?? 1
        engineID = try container.decode(Int.self, forKey: .engineID)
        engine = try container.decode(String.self, forKey: .engine)
        runnerID = try container.decodeIfPresent(Int.self, forKey: .runnerID)
        runner = try container.decodeIfPresent(String.self, forKey: .runner)
        state = try container.decodeIfPresent(String.self, forKey: .state) ?? "starting"
        reason = try container.decodeIfPresent(String.self, forKey: .reason)
        seq = try container.decodeIfPresent(Int.self, forKey: .seq) ?? 0
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        lastSnapshotAt = try container.decodeIfPresent(Date.self, forKey: .lastSnapshotAt)
        gameID = try container.decodeIfPresent(Int.self, forKey: .gameID)
        ply = try container.decodeIfPresent(Int.self, forKey: .ply)
    }
}

/// One variation in a frame, **in the engine's own frame** — see `LiveSnapshot` for where
/// that is flipped. `pv` is UCI (`e2e4`), never SAN: the wire has no board to name moves
/// against, so turning it into readable notation is the view's job.
struct StreamLine: Decodable, Sendable, Equatable {
    let multipv: Int
    let cp: Int?
    let mate: Int?
    let pv: [String]

    enum CodingKeys: String, CodingKey {
        case multipv
        case cp
        case mate
        case pv
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        multipv = try container.decodeIfPresent(Int.self, forKey: .multipv) ?? 1
        cp = try container.decodeIfPresent(Int.self, forKey: .cp)
        mate = try container.decodeIfPresent(Int.self, forKey: .mate)
        pv = try container.decodeIfPresent([String].self, forKey: .pv) ?? []
    }

    /// For the tests and for building a `LiveLine` by hand.
    init(multipv: Int, cp: Int? = nil, mate: Int? = nil, pv: [String] = []) {
        self.multipv = multipv
        self.cp = cp
        self.mate = mate
        self.pv = pv
    }
}

// MARK: - The frames

/// Why a session stopped, and whether that is worth telling the reader.
///
/// `closed` and `replaced` are quiet on purpose: the first is this app asking, the second
/// is another window taking the one session this surface gets. The other three are things
/// that happened *to* the search, and a panel that goes blank without saying so is the bug
/// this distinction exists to prevent.
enum StreamEndReason: String, Sendable, Equatable {
    case closed
    case replaced
    case idle
    case engineFailed = "engine_failed"
    case runnerGone = "runner_gone"
    /// The server grew a reason this build does not know. Treated as worth showing, since
    /// the alternative is a panel that stops for no stated reason.
    case unknown

    init(rawValue: String) {
        switch rawValue {
        case "closed": self = .closed
        case "replaced": self = .replaced
        case "idle": self = .idle
        case "engine_failed": self = .engineFailed
        case "runner_gone": self = .runnerGone
        default: self = .unknown
        }
    }

    /// Whether the panel can simply go back to its off state without a word.
    var isQuiet: Bool { self == .closed }

    /// A whole sentence, because it goes on screen as one. The frame's own `error` wins
    /// where there is one — the engine's or the runner's complaint says more than anything
    /// that could be written here.
    func message(error: String?) -> String {
        if let error, !error.isEmpty { return error }
        switch self {
        case .closed: return "The live search was closed."
        case .replaced: return "Another analysis board took this position over."
        case .idle: return "The live search was closed after sitting idle."
        case .engineFailed: return "The engine running the live search stopped."
        case .runnerGone: return "The machine running the engine went away."
        case .unknown: return "The live search stopped."
        }
    }
}

/// `stream.started` — the session exists and the search is being set up.
struct StreamStartedEvent: Decodable, Sendable, Equatable {
    let sessionID: String
    let surface: String
    let engineID: Int
    let engine: String
    let runnerID: Int?
    let runner: String?
    let fen: String
    let multipv: Int
    let at: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case surface
        case engineID = "engine_id"
        case engine
        case runnerID = "runner_id"
        case runner
        case fen
        case multipv
        case at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionID = try container.decode(String.self, forKey: .sessionID)
        surface = try container.decodeIfPresent(String.self, forKey: .surface) ?? StreamSurface.game.rawValue
        engineID = try container.decode(Int.self, forKey: .engineID)
        engine = try container.decodeIfPresent(String.self, forKey: .engine) ?? ""
        runnerID = try container.decodeIfPresent(Int.self, forKey: .runnerID)
        runner = try container.decodeIfPresent(String.self, forKey: .runner)
        fen = try container.decodeIfPresent(String.self, forKey: .fen) ?? ""
        multipv = try container.decodeIfPresent(Int.self, forKey: .multipv) ?? 1
        at = try container.decodeIfPresent(String.self, forKey: .at) ?? ""
    }
}

/// `stream.snapshot` — one picture of a running search, about twice a second.
///
/// Note what is *not* here: no `runner` name and no `surface`. The session id is the whole
/// of the match, and the machine's name has to come from the response or from
/// `stream.started`.
struct StreamSnapshotEvent: Decodable, Sendable, Equatable {
    let sessionID: String
    /// Assigned by the broker, so local and remote sessions number the same way. A frame
    /// whose `seq` is not ahead of the last accepted one is news that already arrived.
    let seq: Int
    let engineID: Int
    let engine: String
    let runnerID: Int?
    /// The server's spelling of the position this frame is about.
    let fen: String
    let multipv: Int
    let depth: Int?
    let nodes: Int?
    let nps: Int?
    let timeMs: Int?
    let lines: [StreamLine]
    let at: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case seq
        case engineID = "engine_id"
        case engine
        case runnerID = "runner_id"
        case fen
        case multipv
        case depth
        case nodes
        case nps
        case timeMs = "time_ms"
        case lines
        case at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionID = try container.decode(String.self, forKey: .sessionID)
        seq = try container.decodeIfPresent(Int.self, forKey: .seq) ?? 0
        engineID = try container.decodeIfPresent(Int.self, forKey: .engineID) ?? 0
        engine = try container.decodeIfPresent(String.self, forKey: .engine) ?? ""
        runnerID = try container.decodeIfPresent(Int.self, forKey: .runnerID)
        fen = try container.decodeIfPresent(String.self, forKey: .fen) ?? ""
        multipv = try container.decodeIfPresent(Int.self, forKey: .multipv) ?? 1
        depth = try container.decodeIfPresent(Int.self, forKey: .depth)
        nodes = try container.decodeIfPresent(Int.self, forKey: .nodes)
        nps = try container.decodeIfPresent(Int.self, forKey: .nps)
        timeMs = try container.decodeIfPresent(Int.self, forKey: .timeMs)
        lines = try container.decodeIfPresent([StreamLine].self, forKey: .lines) ?? []
        at = try container.decodeIfPresent(String.self, forKey: .at) ?? ""
    }
}

/// `stream.ended` — the session is gone. Nothing else will arrive for this id.
struct StreamEndedEvent: Decodable, Sendable, Equatable {
    let sessionID: String
    let reason: StreamEndReason
    /// The engine's or the runner's own complaint, where there was one.
    let error: String?
    let engineID: Int
    let runnerID: Int?
    let at: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case reason
        case error
        case engineID = "engine_id"
        case runnerID = "runner_id"
        case at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sessionID = try container.decode(String.self, forKey: .sessionID)
        let raw = try container.decodeIfPresent(String.self, forKey: .reason) ?? "closed"
        reason = StreamEndReason(rawValue: raw)
        error = try container.decodeIfPresent(String.self, forKey: .error)
        engineID = try container.decodeIfPresent(Int.self, forKey: .engineID) ?? 0
        runnerID = try container.decodeIfPresent(Int.self, forKey: .runnerID)
        at = try container.decodeIfPresent(String.self, forKey: .at) ?? ""
    }
}

/// The three frames a live-analysis consumer cares about, as one value.
enum StreamEvent: Sendable, Equatable {
    case started(StreamStartedEvent)
    case snapshot(StreamSnapshotEvent)
    case ended(StreamEndedEvent)

    /// Every frame carries one, and it is the only thing that ties a frame to a session —
    /// `stream.ended` carries no surface at all.
    var sessionID: String {
        switch self {
        case let .started(event): return event.sessionID
        case let .snapshot(event): return event.sessionID
        case let .ended(event): return event.sessionID
        }
    }
}

/// Reading one `/events` text frame.
///
/// The socket carries everything the app might follow — imports, analysis runs, notes,
/// runners, a keepalive `ping` — and this build reads three of them. An unrecognised name
/// is **not** an error: a server that grows a family of events must not take the live panel
/// down with it, so anything else answers nil and the caller drops it.
enum StreamEventDecoding {
    private struct Envelope: Decodable {
        let event: String
    }

    static func decode(_ data: Data, using decoder: JSONDecoder) -> StreamEvent? {
        guard let envelope = try? decoder.decode(Envelope.self, from: data) else { return nil }
        do {
            switch envelope.event {
            case "stream.started":
                return .started(try decoder.decode(StreamStartedEvent.self, from: data))
            case "stream.snapshot":
                return .snapshot(try decoder.decode(StreamSnapshotEvent.self, from: data))
            case "stream.ended":
                return .ended(try decoder.decode(StreamEndedEvent.self, from: data))
            default:
                return nil
            }
        } catch {
            // A frame with the right name and the wrong shape is one frame, not a broken
            // socket. Two a second arrive; dropping this one costs half a second of depth.
            return nil
        }
    }
}

// MARK: - What the panel draws

/// One variation, **in White's frame**, with its moves still in UCI.
///
/// The `pv` is deliberately raw. Turning it into `24…Rfe8 25.b3` needs a board to play the
/// moves against, which belongs to the view rather than to a wire type.
struct LiveLine: Sendable, Equatable, Identifiable {
    /// 1 is the engine's best line. The wire does not promise the array is in this order.
    let multipv: Int
    let cp: Int?
    let mate: Int?
    let pv: [String]

    var id: Int { multipv }
}

/// One accepted frame, ready to draw.
///
/// The whole of the conversion is the flip in `whiteRelative(_:blackToMove:)`; nothing else
/// is derived here, so a view can be tested against a `LiveSnapshot` built by hand.
struct LiveSnapshot: Sendable, Equatable {
    let sessionID: String
    let seq: Int
    /// The server's spelling of the position these lines are about.
    let fen: String
    let engine: String
    let depth: Int?
    let nodes: Int?
    let nps: Int?
    let timeMs: Int?
    /// Best line first, whatever order the wire used.
    let lines: [LiveLine]

    /// The engine's own move in this position, or nil while it has yet to report one.
    var top: LiveLine? { lines.first(where: { !$0.pv.isEmpty }) }

    init(_ event: StreamSnapshotEvent) {
        let flip = LiveSnapshot.blackToMove(in: event.fen)
        sessionID = event.sessionID
        seq = event.seq
        fen = event.fen
        engine = event.engine
        depth = event.depth
        nodes = event.nodes
        nps = event.nps
        timeMs = event.timeMs
        lines = event.lines
            .map { LiveSnapshot.whiteRelative($0, blackToMove: flip) }
            .sorted { $0.multipv < $1.multipv }
    }

    /// Whether it is Black's move, read off field two of the FEN.
    ///
    /// The frame's *own* FEN decides, not the board's: the two are the same position but
    /// the server's spelling is the one that came with these scores, and during a restart
    /// the board has already moved on.
    static func blackToMove(in fen: String) -> Bool {
        let fields = fen.split(separator: " ", omittingEmptySubsequences: true)
        guard fields.count >= 2 else { return false }
        return fields[1] == "b"
    }

    /// One line turned into White's frame.
    ///
    /// The backend flips every score with `.pov(board.turn)` before it goes on the wire, so
    /// a line on a Black-to-move position reads positive when Black is winning. Everything
    /// this app draws — the eval bar, the graph, the stored engine lines on a move — is
    /// White-relative, and the live panel sits beside those, so a frame left in the
    /// engine's frame prints the opposite sign for the same position on every Black ply.
    ///
    /// **`mate` is 0 for both "has mated" and "is mated"**, and the sign of that pair then
    /// lives in `cp`. Negating one without the other would turn a forced win into a forced
    /// loss and leave the mate distance saying the opposite, which is why the two move
    /// together here rather than at separate call sites.
    static func whiteRelative(_ line: StreamLine, blackToMove: Bool) -> LiveLine {
        guard blackToMove else {
            return LiveLine(multipv: line.multipv, cp: line.cp, mate: line.mate, pv: line.pv)
        }
        return LiveLine(
            multipv: line.multipv,
            cp: line.cp.map { -$0 },
            mate: line.mate.map { -$0 },
            pv: line.pv
        )
    }
}
