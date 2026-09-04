import Foundation

/// Every failure the app reports, in the shape the backend reports it.
///
/// The backend answers every non-2xx with `{"error": "<stable name>", "detail": "..."}`
/// (`backend/api/errors.py`). The name is the part a client may branch on — the message is
/// written for a person and may be reworded — so the two refusals the whole app has to act
/// on get their own cases and everything else keeps the pair for display.
///
/// `LocalizedError` is conformed to because these strings go on screen: a phone has no
/// console for a caller to inspect, so the error itself has to be sayable.
enum APIError: Error {
    /// The session cookie is gone or was never valid. The app returns to the connect screen.
    case unauthorized
    /// This server has no password yet. Nothing can be read until somebody sets one, and
    /// that is done on the web app rather than here.
    case setupRequired
    /// The public demo refusing a write. A fact about the deployment, not about the request.
    case readOnly
    case notFound
    /// Anything else the server said no to, with whatever it said.
    case server(status: Int, name: String?, message: String?)
    /// The request never got an answer: no network, TLS refused, the host is not there.
    case transport(Error)
    /// An answer arrived that this build cannot read.
    case decoding(Error)
}

extension APIError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Signed out. Enter the server password again."
        case .setupRequired:
            return "This server has no password yet. Set one in the web app first."
        case .readOnly:
            return "This server is read-only, so nothing can be saved to it."
        case .notFound:
            return "That is not on this server any more."
        case let .server(status, _, message):
            return message ?? "The server answered \(status)."
        case .transport:
            return "Could not reach the server."
        case .decoding:
            return "The server sent something this app could not read."
        }
    }

    /// The backend's stable name where there is one, for a caller that wants to branch on
    /// something narrower than the case.
    var name: String? {
        switch self {
        case .unauthorized: return "unauthorized"
        case .setupRequired: return "setup_required"
        case .readOnly: return "read_only"
        case .notFound: return "not_found"
        case let .server(_, name, _): return name
        case .transport, .decoding: return nil
        }
    }
}

extension APIError {
    /// The body of a non-2xx. `detail` is what the backend calls its human sentence;
    /// `message` is accepted as well so a proxy or a future route that spells it that way
    /// still produces something to show.
    private struct Body: Decodable {
        var error: String?
        var detail: String?
        var message: String?

        var sentence: String? { detail ?? message }
    }

    /// A status and a body turned into the case a screen should act on.
    ///
    /// Separate from the transport on purpose: this mapping is the whole of the app's
    /// behaviour on failure, and it is worth being able to test it without a fake
    /// `URLSession`. The two 401s are the reason it exists — `setup_required` and
    /// `unauthorized` arrive with the same status and mean completely different screens.
    static func from(status: Int, data: Data?) -> APIError {
        let body = data.flatMap { try? JSONDecoder().decode(Body.self, from: $0) }
        let name = body?.error
        let message = body?.sentence
        switch status {
        case 401:
            return name == "setup_required" ? .setupRequired : .unauthorized
        case 403:
            return name == "read_only" ? .readOnly : .server(status: status, name: name, message: message)
        case 404:
            return .notFound
        default:
            return .server(status: status, name: name, message: message)
        }
    }
}

/// The one place the app parses a timestamp.
///
/// The backend writes ISO 8601, but not always the same one: a column that came out of
/// SQLite may carry fractional seconds and one that did not may carry none, and a value
/// written by an older import may carry no timezone at all. All three are the same instant
/// as far as this app is concerned, so all three parse here rather than each caller
/// discovering the difference.
enum APIDate {
    private nonisolated(unsafe) static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private nonisolated(unsafe) static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    /// The formatters are shared rather than built per call: `ISO8601DateFormatter` is
    /// documented safe to use from several threads for parsing, and building one per
    /// timestamp would be the expensive part of decoding a three-hundred-move game.
    static func parse(_ raw: String) -> Date? {
        if let date = fractional.date(from: raw) { return date }
        if let date = plain.date(from: raw) { return date }
        // No zone at the end: the backend stores UTC, so read it as UTC rather than as the
        // phone's own time — an hour's drift on a game's date is a wrong day at midnight.
        if !carriesZone(raw) { return plain.date(from: raw + "Z") ?? fractional.date(from: raw + "Z") }
        return nil
    }

    /// What a query parameter sends: one spelling, always with the zone.
    static func string(from date: Date) -> String {
        plain.string(from: date)
    }

    private static func carriesZone(_ raw: String) -> Bool {
        if raw.hasSuffix("Z") || raw.hasSuffix("z") { return true }
        guard let separator = raw.firstIndex(of: "T") else { return false }
        let time = raw[raw.index(after: separator)...]
        return time.contains("+") || time.contains("-")
    }
}

/// The transport: one `URLSession` pointed at one Blunderbase server.
///
/// An actor rather than a class because it owns mutable machinery (the session, the decoder)
/// that several screens will use at once, and because nothing here needs to run on the main
/// thread. Callers are already `async`.
///
/// Authentication is a cookie, not a token. `POST /auth/login` answers with a `Set-Cookie`
/// and every later request has to carry it; there is no per-device token to keep in the
/// keychain. So the session is configured with the shared cookie storage, which persists to
/// disk — the cookie survives an app launch, and a phone that was signed in yesterday is
/// still signed in today without asking the owner for the password again.
actor APIClient {
    /// The server root the owner typed, without the `/api` — what `Session` persists.
    let serverURL: URL

    /// The path every route hangs off. Kept as a string because the server may live under a
    /// prefix (`https://host/blunderbase`) and appending components to a `URL` collapses or
    /// escapes the slashes differently depending on how the base was written.
    private let apiPath: String
    private let urlSession: URLSession
    private let decoder: JSONDecoder
    private let encoder = JSONEncoder()

    init(serverURL: URL, configuration: URLSessionConfiguration? = nil) {
        self.serverURL = serverURL
        var path = serverURL.path
        while path.hasSuffix("/") { path.removeLast() }
        apiPath = path + "/api"
        urlSession = URLSession(configuration: configuration ?? APIClient.makeConfiguration())
        decoder = APIClient.makeDecoder()
    }

    /// The cookie jar is the shared one on purpose: it is the only thing that keeps a phone
    /// signed in across launches, and the app has exactly one server, so there is nothing to
    /// keep apart.
    nonisolated static func makeConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpShouldSetCookies = true
        configuration.httpCookieAcceptPolicy = .always
        configuration.timeoutIntervalForRequest = 30
        return configuration
    }

    /// Exposed so the tests decode fixtures through exactly the decoder the app uses — a
    /// date rule that only the tests agree with would prove nothing.
    nonisolated static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            guard let date = APIDate.parse(raw) else {
                throw DecodingError.dataCorrupted(
                    DecodingError.Context(
                        codingPath: decoder.codingPath,
                        debugDescription: "Not an ISO 8601 timestamp: \(raw)"
                    )
                )
            }
            return date
        }
        return decoder
    }

    // MARK: Requests

    func get<T: Decodable & Sendable>(
        _ path: String,
        query: [URLQueryItem] = [],
        as type: T.Type
    ) async throws -> T {
        let data = try await perform(request(path, method: "GET", query: query, body: nil))
        return try decode(data, as: type)
    }

    func post<B: Encodable & Sendable, T: Decodable & Sendable>(
        _ path: String,
        body: B,
        query: [URLQueryItem] = [],
        as type: T.Type
    ) async throws -> T {
        let payload: Data
        do {
            payload = try encoder.encode(body)
        } catch {
            throw APIError.decoding(error)
        }
        let data = try await perform(request(path, method: "POST", query: query, body: payload))
        return try decode(data, as: type)
    }

    /// A POST whose answer is a 204 — logout. Separate from `post` because there is no body
    /// to decode and `T = Void` is not a `Decodable`.
    func postNoContent(_ path: String, query: [URLQueryItem] = []) async throws {
        _ = try await perform(request(path, method: "POST", query: query, body: nil))
    }

    // MARK: Plumbing

    private func request(
        _ path: String,
        method: String,
        query: [URLQueryItem],
        body: Data?
    ) throws -> URLRequest {
        guard var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else {
            throw APIError.transport(URLError(.badURL))
        }
        components.path = apiPath + path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else { throw APIError.transport(URLError(.badURL)) }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func perform(_ request: URLRequest) async throws -> Data {
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

// MARK: - Query parameters

/// FastAPI reads a repeated key as a list and an absent key as "no filter", so the rule for
/// building a query is: skip what is unset, and never send an empty string — `text=` would
/// be a filter for the empty string rather than no filter at all.
extension URLQueryItem {
    static func text(_ name: String, _ value: String?) -> URLQueryItem? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return URLQueryItem(name: name, value: value)
    }

    static func number(_ name: String, _ value: Int?) -> URLQueryItem? {
        guard let value else { return nil }
        return URLQueryItem(name: name, value: String(value))
    }

    /// Booleans go as `true`/`false`, which is what FastAPI parses. `String(describing:)`
    /// happens to agree, but the spelling is worth pinning down rather than inheriting.
    static func flag(_ name: String, _ value: Bool?) -> URLQueryItem? {
        guard let value else { return nil }
        return URLQueryItem(name: name, value: value ? "true" : "false")
    }

    static func timestamp(_ name: String, _ value: Date?) -> URLQueryItem? {
        guard let value else { return nil }
        return URLQueryItem(name: name, value: APIDate.string(from: value))
    }
}
