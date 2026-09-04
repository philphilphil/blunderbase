import Foundation

/// The wire types, mirroring `backend/api/schemas.py` and `web/src/lib/api/types.ts`.
///
/// Two facts about the backend shape everything in this file.
///
/// The first is `_compact`: every response row is run through a helper that **drops** a key
/// whose value is null rather than sending it as null. So a move that was never analysed
/// arrives as `{"ply": 3, "san": "Nf3", "color": "white"}` and nothing else, and a type that
/// declares a non-optional `classification` cannot decode the library. Every field but the
/// ids is therefore optional, and every one of them must survive an absent key.
///
/// The second is that response models are `extra="allow"`: a payload may carry more than is
/// written here. `Decodable` ignores unknown keys, which is the behaviour we want — a
/// backend that grows a field must not break a phone that has not been updated.
///
/// Keys are spelled out in `CodingKeys` rather than converted by a decoder-wide
/// `.convertFromSnakeCase`, because several types below need a hand-written `init(from:)`
/// anyway and one rule for all of them is easier to trust than two.

// MARK: - Vocabulary

/// Where a game came from. `masters` is a game pulled out of the reference explorer's
/// archive — somebody else's game, kept for study, never synced.
///
/// Unknown values decode as `.unknown` rather than throwing: the server owns this
/// vocabulary and may grow it, and one unrecognised word in a list of fifty games must
/// cost that game's badge, not the whole page.
enum Source: String, Sendable, Equatable {
    case lichess
    case chesscom
    case fics
    case pgn
    case manual
    case masters
    case unknown

    init(rawValue: String) {
        switch rawValue {
        case "lichess": self = .lichess
        case "chesscom": self = .chesscom
        case "fics": self = .fics
        case "pgn": self = .pgn
        case "manual": self = .manual
        case "masters": self = .masters
        default: self = .unknown
        }
    }

    /// What a person calls it. `.unknown` keeps the server's word out of the UI on purpose:
    /// there is nothing useful to say about a source this build has never heard of.
    var label: String {
        switch self {
        case .lichess: return "Lichess"
        case .chesscom: return "Chess.com"
        case .fics: return "FICS"
        case .pgn: return "PGN"
        case .manual: return "Manual"
        case .masters: return "Masters"
        case .unknown: return "Other"
        }
    }
}

extension Source: Decodable {
    init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }
}

/// The time controls the library sorts games into. Tolerant of unknown values for the same
/// reason as `Source`.
enum Speed: String, Sendable, Equatable {
    case bullet
    case blitz
    case rapid
    case classical
    case correspondence
    case unknown

    init(rawValue: String) {
        switch rawValue {
        case "bullet": self = .bullet
        case "blitz": self = .blitz
        case "rapid": self = .rapid
        case "classical": self = .classical
        case "correspondence": self = .correspondence
        default: self = .unknown
        }
    }

    var label: String {
        switch self {
        case .bullet: return "Bullet"
        case .blitz: return "Blitz"
        case .rapid: return "Rapid"
        case .classical: return "Classical"
        case .correspondence: return "Correspondence"
        case .unknown: return "Other"
        }
    }
}

extension Speed: Decodable {
    init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }
}

/// How the analysis judged a move.
///
/// The backend only writes one on a move that lost something — `best` and `good` exist in
/// the vocabulary but a clean move usually carries no classification at all, which is why
/// `MoveRow.classification` is optional and `isFlagged` is the question screens actually ask.
enum Classification: String, Sendable, Equatable {
    case best
    case good
    case inaccuracy
    case mistake
    case blunder
    case unknown

    init(rawValue: String) {
        switch rawValue {
        case "best": self = .best
        case "good": self = .good
        case "inaccuracy": self = .inaccuracy
        case "mistake": self = .mistake
        case "blunder": self = .blunder
        default: self = .unknown
        }
    }

    /// Worst is highest, so `sorted { $0.severity > $1.severity }` puts the blunders on top
    /// — the order every "what went wrong" list wants. `.unknown` sorts below everything
    /// because a word this build cannot read is not evidence of anything.
    var severity: Int {
        switch self {
        case .blunder: return 4
        case .mistake: return 3
        case .inaccuracy: return 2
        case .good: return 1
        case .best: return 0
        case .unknown: return -1
        }
    }

    /// The three the game screen marks up. `best`/`good` are not mistakes and `.unknown`
    /// is not a judgement, so neither is flagged.
    var isMistake: Bool {
        self == .inaccuracy || self == .mistake || self == .blunder
    }

    var label: String {
        switch self {
        case .best: return "Best"
        case .good: return "Good"
        case .inaccuracy: return "Inaccuracy"
        case .mistake: return "Mistake"
        case .blunder: return "Blunder"
        case .unknown: return ""
        }
    }
}

extension Classification: Decodable {
    init(from decoder: Decoder) throws {
        self.init(rawValue: try decoder.singleValueContainer().decode(String.self))
    }
}

/// The two words the API uses for a side, kept as constants rather than an enum: the wire
/// carries `color` as a plain string on both games and moves, and the screens only ever ask
/// "is this White's", which the computed properties below answer.
enum Side {
    static let white = "white"
    static let black = "black"
}

// MARK: - Auth

/// What this deployment can do, as `GET /auth/status` reports it.
///
/// `read_only` is the public demo: every write answers 403 and the app hides its composers
/// rather than letting somebody type a note the server will refuse.
struct RuntimeCapabilities: Decodable, Sendable, Equatable {
    var passwordAuth: Bool?
    var mcp: Bool?
    var remoteRunners: Bool?
    var readOnly: Bool?

    enum CodingKeys: String, CodingKey {
        case passwordAuth = "password_auth"
        case mcp
        case remoteRunners = "remote_runners"
        case readOnly = "read_only"
    }
}

/// The bootstrap payload: is there a password on this server, and do we have it.
///
/// Every `/auth` route answers with this same shape, which is why signing in and checking a
/// restored cookie return the same type. The Maia levels ride along because the one call the
/// app makes before anything renders is this one, and a screen that shows a level should not
/// have to wait on a second round trip for it.
struct AuthStatus: Decodable, Sendable, Equatable {
    var setupRequired: Bool
    var authenticated: Bool
    var capabilities: RuntimeCapabilities?
    /// The first of `maiaElos`, for a screen that shows a single level. Optional only
    /// because `_compact` could drop it; `maiaTargetOrDefault` is what callers read.
    var maiaTargetElo: Int?
    /// Every rating this deployment asks Maia at, lowest first.
    var maiaElos: [Int]?

    /// The backend's own default (`services/app_settings.py`), repeated here for the one
    /// case where the client has to name a level it was not told.
    static let defaultMaiaTargetElo = 2000

    var maiaTargetOrDefault: Int {
        maiaTargetElo ?? maiaElos?.first ?? AuthStatus.defaultMaiaTargetElo
    }

    enum CodingKeys: String, CodingKey {
        case setupRequired = "setup_required"
        case authenticated
        case capabilities
        case maiaTargetElo = "maia_target_elo"
        case maiaElos = "maia_elos"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        setupRequired = try container.decodeIfPresent(Bool.self, forKey: .setupRequired) ?? false
        authenticated = try container.decodeIfPresent(Bool.self, forKey: .authenticated) ?? false
        capabilities = try container.decodeIfPresent(RuntimeCapabilities.self, forKey: .capabilities)
        maiaTargetElo = try container.decodeIfPresent(Int.self, forKey: .maiaTargetElo)
        maiaElos = try container.decodeIfPresent([Int].self, forKey: .maiaElos)
    }

    init(
        setupRequired: Bool = false,
        authenticated: Bool = false,
        capabilities: RuntimeCapabilities? = nil,
        maiaTargetElo: Int? = nil,
        maiaElos: [Int]? = nil
    ) {
        self.setupRequired = setupRequired
        self.authenticated = authenticated
        self.capabilities = capabilities
        self.maiaTargetElo = maiaTargetElo
        self.maiaElos = maiaElos
    }
}

// MARK: - Games

/// One row of the library.
///
/// The owner's side of a game is `color`, and almost every label a screen wants is derived
/// from it rather than stored twice — see `ownerName`/`opponentName`. A game the owner did
/// not play (`isOwnerGame == false`) came in from the reference books for study and counts
/// in no statistic, so `color` is meaningless on it and the derived names return nil.
struct GameSummary: Decodable, Sendable, Equatable, Identifiable {
    let id: Int
    /// Never absent in practice, but decoded leniently: one row with a word this build has
    /// never heard of must not cost the whole page.
    let source: Source
    var sourceID: String?
    var playedAt: Date?
    /// `"white"` or `"black"` — the side the owner had.
    var color: String?
    /// Absent means true. False is a model game from the reference books.
    var isOwnerGame: Bool?
    var result: String?
    var outcome: String?
    var white: String?
    var black: String?
    var whiteRating: Int?
    var blackRating: Int?
    var opponent: String?
    var opponentRating: Int?
    var rating: Int?
    var speed: Speed?
    var timeControl: String?
    var rated: Bool?
    var variant: String?
    var eco: String?
    var opening: String?
    var termination: String?
    var plyCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case source
        case sourceID = "source_id"
        case playedAt = "played_at"
        case color
        case isOwnerGame = "is_owner_game"
        case result
        case outcome
        case white
        case black
        case whiteRating = "white_rating"
        case blackRating = "black_rating"
        case opponent
        case opponentRating = "opponent_rating"
        case rating
        case speed
        case timeControl = "time_control"
        case rated
        case variant
        case eco
        case opening
        case termination
        case plyCount = "ply_count"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        source = try container.decodeIfPresent(Source.self, forKey: .source) ?? .unknown
        sourceID = try container.decodeIfPresent(String.self, forKey: .sourceID)
        playedAt = try container.decodeIfPresent(Date.self, forKey: .playedAt)
        color = try container.decodeIfPresent(String.self, forKey: .color)
        isOwnerGame = try container.decodeIfPresent(Bool.self, forKey: .isOwnerGame)
        result = try container.decodeIfPresent(String.self, forKey: .result)
        outcome = try container.decodeIfPresent(String.self, forKey: .outcome)
        white = try container.decodeIfPresent(String.self, forKey: .white)
        black = try container.decodeIfPresent(String.self, forKey: .black)
        whiteRating = try container.decodeIfPresent(Int.self, forKey: .whiteRating)
        blackRating = try container.decodeIfPresent(Int.self, forKey: .blackRating)
        opponent = try container.decodeIfPresent(String.self, forKey: .opponent)
        opponentRating = try container.decodeIfPresent(Int.self, forKey: .opponentRating)
        rating = try container.decodeIfPresent(Int.self, forKey: .rating)
        speed = try container.decodeIfPresent(Speed.self, forKey: .speed)
        timeControl = try container.decodeIfPresent(String.self, forKey: .timeControl)
        rated = try container.decodeIfPresent(Bool.self, forKey: .rated)
        variant = try container.decodeIfPresent(String.self, forKey: .variant)
        eco = try container.decodeIfPresent(String.self, forKey: .eco)
        opening = try container.decodeIfPresent(String.self, forKey: .opening)
        termination = try container.decodeIfPresent(String.self, forKey: .termination)
        plyCount = try container.decodeIfPresent(Int.self, forKey: .plyCount)
    }

    /// Nil when the row does not say — a reference game, or a PGN whose owner could not be
    /// matched to either name. Callers must not read nil as "black".
    var ownerIsWhite: Bool? {
        switch color {
        case Side.white: return true
        case Side.black: return false
        default: return nil
        }
    }

    /// The owner's own name in this game, picked by the side they had rather than stored
    /// separately, so it can never disagree with the board's orientation.
    var ownerName: String? {
        switch ownerIsWhite {
        case .some(true): return white
        case .some(false): return black
        case nil: return nil
        }
    }

    /// The other name, falling back to the `opponent` column the backend already denormalises
    /// — that one is filled in even where the side is not known.
    var opponentName: String? {
        switch ownerIsWhite {
        case .some(true): return black ?? opponent
        case .some(false): return white ?? opponent
        case nil: return opponent
        }
    }

    /// True unless the row says otherwise: the backend omits the key on the common case.
    var isOwners: Bool { isOwnerGame ?? true }
}

/// One point of a game's eval curve. `win` is a win percentage, 0…100, already from
/// **White's** side — the curve is the one thing the backend orients for the caller, so a
/// graph plots it as it arrives.
///
/// `ply` is the 0-based ply of the move the point is the evaluation *after*, on the same
/// scale as `WorstMoment.ply`, which is what lets a sparkline put a flag tick on the curve.
struct EvalPoint: Decodable, Sendable, Equatable, Identifiable {
    let ply: Int
    var win: Double?

    var id: Int { ply }

    enum CodingKeys: String, CodingKey {
        case ply
        case win
    }
}

/// A move the analysis singled out, as the game cards carry it — enough to label a row and
/// jump to the ply, without the whole move list.
///
/// `ply` is the move's own 0-based ply, the same scale `MoveRow` and `EvalPoint` use.
struct WorstMoment: Decodable, Sendable, Equatable, Identifiable {
    let ply: Int
    var moveNumber: Int?
    var san: String?
    var uci: String?
    /// How much win percentage the move gave away, 0…100.
    var winLoss: Double?
    var classification: Classification?
    var bestMoveUci: String?

    var id: Int { ply }

    enum CodingKeys: String, CodingKey {
        case ply
        case moveNumber = "move_number"
        case san
        case uci
        case winLoss = "win_loss"
        case classification
        case bestMoveUci = "best_move_uci"
    }
}

/// A library row with the card extras attached — what `GET /games?cards=true` answers, and
/// the only list shape this app asks for.
///
/// It composes rather than repeats: the summary fields decode from the *same* JSON object
/// through `GameSummary(from:)`, because the backend flattens the two into one row. Keeping
/// `game` as a stored value means a card and a detail screen read the same struct and cannot
/// drift apart.
struct GameCard: Decodable, Sendable, Equatable, Identifiable {
    let game: GameSummary
    /// Whether any pass has finished. Absent on a row the backend built without the cards.
    var analyzed: Bool?
    /// Whether a deep pass has.
    var deep: Bool?
    var evalCurve: [EvalPoint]?
    var worstMoments: [WorstMoment]?

    var id: Int { game.id }

    enum CodingKeys: String, CodingKey {
        case analyzed
        case deep
        case evalCurve = "eval_curve"
        case worstMoments = "worst_moments"
    }

    init(from decoder: Decoder) throws {
        game = try GameSummary(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        analyzed = try container.decodeIfPresent(Bool.self, forKey: .analyzed)
        deep = try container.decodeIfPresent(Bool.self, forKey: .deep)
        evalCurve = try container.decodeIfPresent([EvalPoint].self, forKey: .evalCurve)
        worstMoments = try container.decodeIfPresent([WorstMoment].self, forKey: .worstMoments)
    }
}

/// One page of the library. `total` is the size of the whole filtered set, not of `games`,
/// which is what lets a list say "50 of 1,284" and know when to ask for more.
struct GameList: Decodable, Sendable, Equatable {
    var games: [GameCard]
    var total: Int
    var limit: Int
    var offset: Int

    enum CodingKeys: String, CodingKey {
        case games
        case total
        case limit
        case offset
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        games = try container.decodeIfPresent([GameCard].self, forKey: .games) ?? []
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? 0
        limit = try container.decodeIfPresent(Int.self, forKey: .limit) ?? games.count
        offset = try container.decodeIfPresent(Int.self, forKey: .offset) ?? 0
    }
}

// MARK: - Analysis

/// One engine line at a ply. `cp` and `mate` are exclusive and both may be absent on a line
/// the engine reported without a score; `pv`/`san` are the same continuation in two
/// alphabets, so a board arrows `pv` and a list prints `san`.
struct BestLine: Decodable, Sendable, Equatable {
    /// 1 is the engine's first choice. Absent on a single-line pass.
    var multipv: Int?
    var cp: Int?
    var mate: Int?
    var pv: [String]?
    var san: [String]?
    var moveUci: String?
    var moveSan: String?

    enum CodingKeys: String, CodingKey {
        case multipv
        case cp
        case mate
        case pv
        case san
        case moveUci = "move_uci"
        case moveSan = "move_san"
    }
}

/// One move the human model offers at a rating.
///
/// `p` is the policy share, 0…1 — a probability, not a percentage — and is absent on builds
/// that publish no figure, which is why a bar drawn from it must handle nil rather than
/// treat it as zero.
struct MaiaMove: Decodable, Sendable, Equatable, Identifiable {
    let uci: String
    var san: String?
    var rank: Int?
    var p: Double?

    var id: String { uci }

    enum CodingKeys: String, CodingKey {
        case uci
        case san
        case rank
        case p
    }
}

/// What a human of each configured rating would play here.
///
/// On the wire this is a bare JSON object keyed by the Elo band **as a string**
/// (`{"1500": [...], "1700": [...]}`), because a deployment picks its own levels and the
/// blob is written by the engine adapter rather than by a schema. It is read into `[Int: …]`
/// so a screen can compare levels numerically and sort them, and any key that is not a
/// number is skipped rather than throwing: one unreadable band must not cost the move its
/// whole analysis.
struct MaiaPolicy: Decodable, Sendable, Equatable {
    /// Rating band to that band's moves, already ordered best-ranked first.
    let levels: [Int: [MaiaMove]]

    /// Lowest rating first — the order the compare grid draws its columns in.
    var ratings: [Int] { levels.keys.sorted() }

    func moves(at elo: Int) -> [MaiaMove] { levels[elo] ?? [] }

    /// A `CodingKey` that accepts whatever the blob happens to be keyed by, since the levels
    /// are a deployment's choice rather than a fixed set.
    private struct BandKey: CodingKey {
        let stringValue: String
        var intValue: Int? { Int(stringValue) }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { self.stringValue = String(intValue) }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: BandKey.self)
        var found: [Int: [MaiaMove]] = [:]
        for key in container.allKeys {
            guard let elo = Int(key.stringValue) else { continue }
            guard let moves = try? container.decode([MaiaMove].self, forKey: key) else { continue }
            // Ranked here rather than at every call site: the order is a property of the
            // policy, and a band whose entries carry no rank keeps the order it arrived in.
            found[elo] = moves.enumerated()
                .sorted { ($0.element.rank ?? $0.offset + 1) < ($1.element.rank ?? $1.offset + 1) }
                .map(\.element)
        }
        levels = found
    }

    init(levels: [Int: [MaiaMove]]) {
        self.levels = levels
    }
}

/// One half-move of a game, with whatever analysis has been done to it.
///
/// `ply` is the move's own index, **0-based**: ply 0 is White's first move, ply 1 is
/// Black's reply, and `move_number` is `ply / 2 + 1`. It is not the same scale as the
/// cursor, which counts half-moves *played* — the move at ply `p` is played from cursor `p`
/// and arrives at cursor `p + 1`. Everything else is optional because an unanalysed game is
/// a list of these carrying nothing but the move.
struct MoveRow: Decodable, Sendable, Equatable, Identifiable {
    let ply: Int
    /// The whole move number a person says out loud — 1 for both plies of move 1.
    var moveNumber: Int?
    /// `"white"` or `"black"`: the side that made this move.
    var color: String?
    var san: String?
    /// `"e2e4"`, or `"e7e8q"` with the promotion piece appended.
    var uci: String?
    /// Seconds left on the mover's clock after the move.
    var clock: Double?
    var byOwner: Bool?
    var evalBeforeCp: Int?
    var evalBeforeMate: Int?
    var evalAfterCp: Int?
    var evalAfterMate: Int?
    /// Win percentage before the move, 0…100, **from the mover's side**. See `whiteWinBefore`.
    var winBefore: Double?
    /// Win percentage after the move, on the same footing as `winBefore`.
    var winAfter: Double?
    /// How much of it the move gave away.
    var winLoss: Double?
    var classification: Classification?
    var bestMoveUci: String?
    var bestLines: [BestLine]?
    var maia: MaiaPolicy?
    var runID: Int?

    var id: Int { ply }

    enum CodingKeys: String, CodingKey {
        case ply
        case moveNumber = "move_number"
        case color
        case san
        case uci
        case clock
        case byOwner = "by_owner"
        case evalBeforeCp = "eval_before_cp"
        case evalBeforeMate = "eval_before_mate"
        case evalAfterCp = "eval_after_cp"
        case evalAfterMate = "eval_after_mate"
        case winBefore = "win_before"
        case winAfter = "win_after"
        case winLoss = "win_loss"
        case classification
        case bestMoveUci = "best_move_uci"
        case bestLines = "best_lines"
        case maia
        case runID = "run_id"
    }

    /// Whether the analysis judged this an inaccuracy, a mistake or a blunder — the question
    /// a move list asks. A move with no classification at all is the common case and is not
    /// flagged.
    var isFlagged: Bool { classification?.isMistake ?? false }

    /// Which side made the move. `color` says so; a row that lost it falls back to the ply's
    /// parity, since plies are numbered from zero and ply 0 is White's first move.
    var isWhiteMove: Bool {
        switch color {
        case Side.white: return true
        case Side.black: return false
        default: return ply % 2 == 0
        }
    }

    /// `winBefore` rewritten from **White's** point of view.
    ///
    /// The API reports win percentage from the side that moved, so an even position is 50
    /// on both sides and a Black advantage reads as a *high* number on Black's plies.
    /// Anything that draws one continuous line — the eval graph, the eval bar — needs one
    /// fixed point of view, and White's is the convention. Reading the raw field into such a
    /// view mirrors every other point of the graph and looks plausible while being wrong,
    /// which is why the flip lives here and not at the call sites.
    var whiteWinBefore: Double? { fromWhite(winBefore) }

    /// `winAfter` from White's point of view, on the same rule as `whiteWinBefore`.
    var whiteWinAfter: Double? { fromWhite(winAfter) }

    private func fromWhite(_ value: Double?) -> Double? {
        guard let value else { return nil }
        return isWhiteMove ? value : 100 - value
    }
}

/// The compact run row a game detail carries — the service names the engine instead of its
/// id and leaves the queue bookkeeping out.
///
/// `maiaOnly` is the one that matters when reading a tier: a fill pass borrows a tier's
/// engine to ask the human model and searches nothing, so `tier` alone does not say what the
/// run did.
struct RunSummary: Decodable, Sendable, Equatable, Identifiable {
    let id: Int
    var tier: String?
    var maiaOnly: Bool?
    var status: String?
    var engine: String?
    var engineKind: String?
    var depth: Int?
    var nodes: Int?
    var multipv: Int?
    var plyStart: Int?
    var plyEnd: Int?
    var finishedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case tier
        case maiaOnly = "maia_only"
        case status
        case engine
        case engineKind = "engine_kind"
        case depth
        case nodes
        case multipv
        case plyStart = "ply_start"
        case plyEnd = "ply_end"
        case finishedAt = "finished_at"
    }
}

// MARK: - The owner's own book

/// One continuation the owner has played out of a position.
struct BookMove: Decodable, Sendable, Equatable, Identifiable {
    var uci: String?
    var san: String?
    var games: Int?
    var wins: Int?
    var draws: Int?
    var losses: Int?
    /// The owner's score from this move, 0…1.
    var score: Double?
    var ownerMoves: Int?
    var evaluated: Int?
    /// Average win percentage given away when playing it — the reason a move with a fine
    /// score can still be the one to stop playing.
    var avgWinLoss: Double?
    var blunders: Int?

    var id: String { uci ?? san ?? "?" }

    enum CodingKeys: String, CodingKey {
        case uci
        case san
        case games
        case wins
        case draws
        case losses
        case score
        case ownerMoves = "owner_moves"
        case evaluated
        case avgWinLoss = "avg_win_loss"
        case blunders
    }
}

/// One position's book: how often the owner reached it, and what they played from it.
struct BookEntry: Decodable, Sendable, Equatable {
    var games: Int?
    var wins: Int?
    var draws: Int?
    var losses: Int?
    var score: Double?
    var moves: [BookMove]?

    enum CodingKeys: String, CodingKey {
        case games
        case wins
        case draws
        case losses
        case score
        case moves
    }
}

// MARK: - The game screen's payload

/// Everything one game needs, in one call.
///
/// The book ships with the game rather than from a per-position endpoint on purpose: a fetch
/// per ply while somebody steps through a game is the pattern that took the server down once
/// already (`memory/blunderbase-meltdown-root-cause.md`).
struct GameDetail: Decodable, Sendable, Equatable {
    let game: GameSummary
    /// `[first, last]` 0-based move plies, when the detail was asked for a slice of the game.
    var plyRange: [Int]?
    var moves: [MoveRow]
    var runs: [RunSummary]
    var notes: [NoteResponse]?
    /// The owner's own tree at the plies that have one, keyed by half-move **count** — the
    /// position *before* that ply. JSON object keys are strings, so this is read into `Int`
    /// keys here and a lookup is `book?[ply]` rather than `book?[String(ply)]`.
    ///
    /// Most plies have no entry, which is the common case rather than a gap: nearly every
    /// position in the library is reached by exactly one game.
    var book: [Int: BookEntry]?

    enum CodingKeys: String, CodingKey {
        case game
        case plyRange = "ply_range"
        case moves
        case runs
        case notes
        case book
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        game = try container.decode(GameSummary.self, forKey: .game)
        plyRange = try container.decodeIfPresent([Int].self, forKey: .plyRange)
        moves = try container.decodeIfPresent([MoveRow].self, forKey: .moves) ?? []
        runs = try container.decodeIfPresent([RunSummary].self, forKey: .runs) ?? []
        notes = try container.decodeIfPresent([NoteResponse].self, forKey: .notes)
        let raw = try container.decodeIfPresent([String: BookEntry].self, forKey: .book)
        book = raw.map { entries in
            Dictionary(
                entries.compactMap { key, value in Int(key).map { ($0, value) } },
                uniquingKeysWith: { first, _ in first }
            )
        }
    }

    /// The move with that 0-based ply, or nil where the game does not carry it. Linear rather
    /// than indexed because a game is a few hundred rows and a windowed list does not start
    /// at ply 0.
    func move(atPly ply: Int) -> MoveRow? {
        moves.first { $0.ply == ply }
    }
}

// MARK: - Notes

/// Just enough of a game to label a note with it.
///
/// The backend's brief is a loose dict rather than a schema, so every field is optional and
/// unknown keys are ignored. `date` is a plain day (`2026-08-22`) and not a timestamp, which
/// is why it stays a string; `playedAt` is decoded with `try?` so a server that fills it with
/// a day rather than an instant costs the label its date instead of the note its decode.
struct GameBrief: Decodable, Sendable, Equatable {
    var id: Int?
    var white: String?
    var black: String?
    var result: String?
    var opening: String?
    /// `YYYY-MM-DD`, as the brief writes it.
    var date: String?
    var playedAt: Date?
    var isOwnerGame: Bool?

    enum CodingKeys: String, CodingKey {
        case id
        case white
        case black
        case result
        case opening
        case date
        case playedAt = "played_at"
        case isOwnerGame = "is_owner_game"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(Int.self, forKey: .id)
        white = try container.decodeIfPresent(String.self, forKey: .white)
        black = try container.decodeIfPresent(String.self, forKey: .black)
        result = try container.decodeIfPresent(String.self, forKey: .result)
        opening = try container.decodeIfPresent(String.self, forKey: .opening)
        date = try container.decodeIfPresent(String.self, forKey: .date)
        playedAt = try? container.decodeIfPresent(Date.self, forKey: .playedAt)
        isOwnerGame = try container.decodeIfPresent(Bool.self, forKey: .isOwnerGame)
    }
}

/// The move a note was written on, already spelled by the backend, so a note that resurfaces
/// at a position reached some other way can still name where it came from.
///
/// Its `ply` is the note's, so a half-move **count** rather than a move index — the backend
/// builds this label from the position *after* the move (`services/notes.py::_move_label`),
/// which means the move itself is the one at `ply - 1`. `label` is spelled server-side and
/// is the field to prefer for exactly that reason.
struct MoveBrief: Decodable, Sendable, Equatable {
    var ply: Int?
    var moveNumber: Int?
    var color: String?
    var san: String?
    /// `3. Bb5` or `3... a6` — what a person writes, built server-side so every client spells
    /// it the same way.
    var label: String?
    var classification: Classification?
    /// True for a move inside a kept variation rather than one of the game's own.
    var onLine: Bool?

    enum CodingKeys: String, CodingKey {
        case ply
        case moveNumber = "move_number"
        case color
        case san
        case label
        case classification
        case onLine = "on_line"
    }
}

/// A note with its anchors resolved.
///
/// `ply` is a half-move **count**, not a move index: 0 is the starting position and `n` the
/// position after `n` half-moves — so the move it is about is `MoveRow` ply `n - 1`, and the
/// note belongs *after* it. It is the scale `GameStore.cursor` counts in, which is why
/// seeking to a note is a plain `seek(to: note.ply)` while naming its move is not.
/// `scope` says which anchors it has at all (`game`, `position`, `line`
/// or `free`), and the game and move briefs ride along so a list of notes renders without a
/// second call per row.
struct NoteResponse: Decodable, Sendable, Equatable, Identifiable {
    let id: Int
    var text: String
    var tags: [String]?
    var gameID: Int?
    var ply: Int?
    var lineID: Int?
    /// Who wrote it: `web`, `mcp` (the coach) or `live` (a snapshot of the shared board).
    var source: String?
    var fen: String?
    var scope: String?
    var createdAt: Date?
    var updatedAt: Date?
    var game: GameBrief?
    var move: MoveBrief?

    enum CodingKeys: String, CodingKey {
        case id
        case text
        case tags
        case gameID = "game_id"
        case ply
        case lineID = "line_id"
        case source
        case fen
        case scope
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case game
        case move
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        tags = try container.decodeIfPresent([String].self, forKey: .tags)
        gameID = try container.decodeIfPresent(Int.self, forKey: .gameID)
        ply = try container.decodeIfPresent(Int.self, forKey: .ply)
        lineID = try container.decodeIfPresent(Int.self, forKey: .lineID)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        fen = try container.decodeIfPresent(String.self, forKey: .fen)
        scope = try container.decodeIfPresent(String.self, forKey: .scope)
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        game = try container.decodeIfPresent(GameBrief.self, forKey: .game)
        move = try container.decodeIfPresent(MoveBrief.self, forKey: .move)
    }
}

// MARK: - Stats

/// One of the worst recent moments, as `GET /stats/worst-moments` answers it: the game it
/// happened in, the move that was played, and what the engine wanted instead.
///
/// It is deliberately **not** `WorstMoment`. That one rides on a game card and is therefore
/// already inside a game — it needs no `game`, because the row it draws in supplies the
/// opponent and the date. This one arrives on its own, ranked across the whole library, so
/// it carries its game with it and is the only thing a tile has to read.
///
/// `ply` is the move's own **0-based ply**, the same scale `MoveRow` and `WorstMoment` use:
/// the move was played *from* cursor `ply`, which is the position somebody opening this
/// moment wants to land on — the question, not the answer.
struct MomentResponse: Decodable, Sendable, Equatable, Identifiable {
    let game: GameSummary
    let ply: Int
    var moveNumber: Int?
    var san: String?
    var uci: String?
    var classification: Classification?
    /// How much win percentage the move gave away, 0…100. The list is ranked by it.
    var winLoss: Double?
    /// `opening`, `middlegame` or `endgame` — the server's own bucketing.
    var phase: String?
    /// The piece that moved, as the server's single letter.
    var piece: String?
    /// The position the move was played *from*.
    var fen: String?
    var bestMoveUci: String?
    var bestMoveSan: String?

    /// The service keeps one moment per game, so the id could be the game's; it is the pair
    /// because that is what actually identifies a position, and a future amount-per-game
    /// would otherwise put two rows with the same id in a `ForEach`.
    var id: String { "\(game.id)-\(ply)" }

    enum CodingKeys: String, CodingKey {
        case game
        case ply
        case moveNumber = "move_number"
        case san
        case uci
        case classification
        case winLoss = "win_loss"
        case phase
        case piece
        case fen
        case bestMoveUci = "best_move_uci"
        case bestMoveSan = "best_move_san"
    }
}
