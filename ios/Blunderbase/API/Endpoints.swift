import Foundation

/// Which way a sorted column runs.
enum SortDirection: String, Sendable, Equatable {
    case ascending = "asc"
    case descending = "desc"
}

/// Whose games a query is about. `mine` is the default and the answer the app almost always
/// wants; `others` is the model games imported from the reference books, which the owner did
/// not play and which count in no statistic.
enum Whose: String, Sendable, Equatable {
    case mine
    case others
    case all
}

/// The vocabulary of `GET /games`, in one struct.
///
/// It exists so a screen can hold "what the library is filtered to" as one value it can
/// compare, copy and page — the paging fields sit beside the filters for that reason, even
/// though the backend treats them separately.
///
/// Ordering is the server's job rather than the client's: a page is a page, and reordering
/// the fifty rows a phone happens to hold would answer a different question than the one the
/// sort control asks, which is about the whole filtered library.
struct GameQuery: Sendable, Equatable {
    /// The backend caps a page at 200 and refuses 0, so `queryItems` clamps rather than
    /// letting a caller's arithmetic turn into a 422.
    static let maxLimit = 200

    var limit: Int = 50
    var offset: Int = 0
    /// One of `backend/services/games.py: GAME_ORDERS`; `played_at` is the default there too.
    var order: String = "played_at"
    var direction: SortDirection = .descending

    /// Free text over names and openings.
    var text: String?
    /// `win`, `loss` or `draw`, from the owner's side.
    var outcome: String?
    /// The PGN result — `1-0`, `0-1`, `1/2-1/2`, `*`.
    var result: String?
    /// The colour the owner had: `white` or `black`.
    var color: String?
    var source: Source?
    /// Repeatable: several speeds keep games of all of them. `.unknown` is dropped, since it
    /// is this app's word for a value it could not read rather than one the server knows.
    var speeds: [Speed] = []
    /// An ECO code or a prefix of one, e.g. `C6`.
    var eco: String?
    var opponent: String?
    var timeControl: String?
    var hasBlunders: Bool?
    var analyzed: Bool?
    var deepAnalyzed: Bool?
    var since: Date?
    var until: Date?
    var whose: Whose = .mine

    init() {}

    var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), GameQuery.maxLimit))),
            URLQueryItem(name: "offset", value: String(max(offset, 0))),
            URLQueryItem(name: "order", value: order),
            URLQueryItem(name: "direction", value: direction.rawValue),
            URLQueryItem(name: "whose", value: whose.rawValue),
        ]
        let optional: [URLQueryItem?] = [
            .text("text", text),
            .text("outcome", outcome),
            .text("result", result),
            .text("color", color),
            .text("source", source.flatMap { $0 == .unknown ? nil : $0.rawValue }),
            .text("eco", eco),
            .text("opponent", opponent),
            .text("time_control", timeControl),
            .flag("has_blunders", hasBlunders),
            .flag("analyzed", analyzed),
            .flag("deep_analyzed", deepAnalyzed),
            .timestamp("since", since),
            .timestamp("until", until),
        ]
        items.append(contentsOf: optional.compactMap { $0 })
        // The same key repeated, which is how FastAPI reads a set — `speed=blitz&speed=rapid`
        // keeps both rather than the last one.
        items.append(
            contentsOf: speeds
                .filter { $0 != .unknown }
                .map { URLQueryItem(name: "speed", value: $0.rawValue) }
        )
        return items
    }
}

/// The typed surface the rest of the app calls.
///
/// Everything above it is transport and everything below it is a screen: a view never names
/// a path, a status code or a query key. The paths live here as constants for the same
/// reason the web client keeps its own in one module — a route that moves should break in one
/// place.
struct Endpoints: Sendable {
    let client: APIClient

    init(serverURL: URL) {
        client = APIClient(serverURL: serverURL)
    }

    /// For a caller that already has a client — the tests, and anything that wants to share
    /// one session rather than open a second cookie jar.
    init(client: APIClient) {
        self.client = client
    }

    enum Path {
        static let authStatus = "/auth/status"
        static let login = "/auth/login"
        static let logout = "/auth/logout"
        static let games = "/games"
        static let notes = "/notes"

        static func game(_ id: Int) -> String { "/games/\(id)" }
    }

    // MARK: Auth

    /// The one call that works signed out — the app's bootstrap, and the way a restored
    /// cookie is checked.
    func authStatus() async throws -> AuthStatus {
        try await client.get(Path.authStatus, as: AuthStatus.self)
    }

    /// Answers with the same status shape as `authStatus`, plus the `Set-Cookie` that makes
    /// every later request work. Nothing is stored here: the cookie jar keeps it.
    func login(password: String) async throws -> AuthStatus {
        try await client.post(Path.login, body: LoginRequest(password: password), as: AuthStatus.self)
    }

    /// 204, and the cookie is cleared server-side. A client asking to be signed out is never
    /// refused, so a failure here is a network failure and nothing else.
    func logout() async throws {
        try await client.postNoContent(Path.logout)
    }

    // MARK: Games

    /// One page of the library, always with the cards: the phone's list rows draw the eval
    /// curve and the worst moment, so asking without them would mean a second call per row.
    func listGames(_ query: GameQuery = GameQuery()) async throws -> GameList {
        var items = query.queryItems
        items.append(URLQueryItem(name: "cards", value: "true"))
        return try await client.get(Path.games, query: items, as: GameList.self)
    }

    /// One game with its moves, its runs, its book and — unless asked otherwise — its notes.
    func game(id: Int, notes: Bool = true) async throws -> GameDetail {
        try await client.get(
            Path.game(id),
            query: [URLQueryItem.flag("notes", notes)].compactMap { $0 },
            as: GameDetail.self
        )
    }

    // MARK: Notes

    func notes(limit: Int = 50, gameID: Int? = nil, query: String? = nil) async throws -> [NoteResponse] {
        let items: [URLQueryItem?] = [
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), GameQuery.maxLimit))),
            .number("game_id", gameID),
            .text("query", query),
        ]
        return try await client.get(Path.notes, query: items.compactMap { $0 }, as: [NoteResponse].self)
    }

    /// A note, anchored to as much as the writer could name: a game, a ply in it, or nothing
    /// at all. Answers 201 with the note as it was stored, anchors resolved.
    func createNote(
        text: String,
        tags: [String] = [],
        gameID: Int? = nil,
        ply: Int? = nil
    ) async throws -> NoteResponse {
        let body = NoteCreateRequest(text: text, tags: tags, gameID: gameID, ply: ply)
        return try await client.post(Path.notes, body: body, as: NoteResponse.self)
    }
}

// MARK: - Request bodies

private struct LoginRequest: Encodable, Sendable {
    let password: String
}

/// What `POST /notes` takes. The optional anchors are omitted rather than sent as null,
/// which is what `Encodable` does with an optional by default and what the backend expects:
/// a null `game_id` and an absent one mean the same thing to it, but the absent one is what
/// every other client sends.
private struct NoteCreateRequest: Encodable, Sendable {
    let text: String
    let tags: [String]
    let gameID: Int?
    let ply: Int?
    /// The backend's note sources are `web`, `mcp` and `live`. The phone is another window
    /// onto the same library rather than a fourth kind of author, so it files its notes as
    /// `web` — a note written here reads the same as one written in the browser.
    let source = "web"

    enum CodingKeys: String, CodingKey {
        case text
        case tags
        case gameID = "game_id"
        case ply
        case source
    }
}
