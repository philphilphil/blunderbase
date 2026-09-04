import XCTest

@testable import Blunderbase

/// What these tests are actually about: the backend drops null fields instead of sending
/// them, so the shapes below are written the way the wire really looks — keys absent, not
/// null — rather than the way the schema reads. A model that decodes a hand-written "full"
/// payload and nothing else would pass and still fail against the server.
///
/// Everything decodes through `APIClient.makeDecoder()` rather than a decoder built here, so
/// a date rule the app does not use cannot be what the tests prove.
final class ModelsDecodingTests: XCTestCase {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try APIClient.makeDecoder().decode(type, from: Data(json.utf8))
    }

    private func utc(
        _ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int, _ second: Int
    ) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        components.second = second
        return calendar.date(from: components)!
    }

    // MARK: Games

    func testMinimalGameSummaryDecodes() throws {
        let game = try decode(GameSummary.self, #"{"id": 7, "source": "lichess"}"#)

        XCTAssertEqual(game.id, 7)
        XCTAssertEqual(game.source, .lichess)
        XCTAssertNil(game.sourceID)
        XCTAssertNil(game.playedAt)
        XCTAssertNil(game.color)
        XCTAssertNil(game.isOwnerGame)
        XCTAssertNil(game.result)
        XCTAssertNil(game.outcome)
        XCTAssertNil(game.white)
        XCTAssertNil(game.black)
        XCTAssertNil(game.whiteRating)
        XCTAssertNil(game.blackRating)
        XCTAssertNil(game.opponent)
        XCTAssertNil(game.opponentRating)
        XCTAssertNil(game.rating)
        XCTAssertNil(game.speed)
        XCTAssertNil(game.timeControl)
        XCTAssertNil(game.rated)
        XCTAssertNil(game.variant)
        XCTAssertNil(game.eco)
        XCTAssertNil(game.opening)
        XCTAssertNil(game.termination)
        XCTAssertNil(game.plyCount)
        // Absent means the owner played it, which is what every list assumes.
        XCTAssertTrue(game.isOwners)
        XCTAssertNil(game.ownerIsWhite)
        XCTAssertNil(game.ownerName)
    }

    func testOwnerAndOpponentComeFromTheSidePlayed() throws {
        let asBlack = try decode(
            GameSummary.self,
            #"{"id": 1, "source": "lichess", "color": "black", "white": "opp", "black": "phib"}"#
        )
        XCTAssertEqual(asBlack.ownerIsWhite, false)
        XCTAssertEqual(asBlack.ownerName, "phib")
        XCTAssertEqual(asBlack.opponentName, "opp")

        let asWhite = try decode(
            GameSummary.self,
            #"{"id": 2, "source": "pgn", "color": "white", "white": "phib", "black": "opp"}"#
        )
        XCTAssertEqual(asWhite.ownerIsWhite, true)
        XCTAssertEqual(asWhite.ownerName, "phib")
        XCTAssertEqual(asWhite.opponentName, "opp")
    }

    func testGameListWithCardsDecodes() throws {
        let json = """
        {
          "games": [
            {
              "id": 412,
              "source": "lichess",
              "source_id": "aBcD1234",
              "played_at": "2026-08-22T19:04:11Z",
              "color": "white",
              "result": "1-0",
              "outcome": "win",
              "white": "phib",
              "black": "someone",
              "white_rating": 1712,
              "black_rating": 1698,
              "opponent": "someone",
              "opponent_rating": 1698,
              "rating": 1712,
              "speed": "blitz",
              "time_control": "300+3",
              "rated": true,
              "eco": "C65",
              "opening": "Ruy Lopez",
              "ply_count": 61,
              "analyzed": true,
              "deep": false,
              "eval_curve": [
                {"ply": 0, "win": 50.4},
                {"ply": 1, "win": 43.2},
                {"ply": 2}
              ],
              "worst_moments": [
                {
                  "ply": 23,
                  "move_number": 12,
                  "san": "Nxe5",
                  "uci": "f3e5",
                  "win_loss": 31.5,
                  "classification": "blunder",
                  "best_move_uci": "d2d4"
                }
              ]
            },
            {"id": 413, "source": "pgn"}
          ],
          "total": 1284,
          "limit": 50,
          "offset": 0
        }
        """

        let page = try decode(GameList.self, json)

        XCTAssertEqual(page.total, 1284)
        XCTAssertEqual(page.limit, 50)
        XCTAssertEqual(page.offset, 0)
        XCTAssertEqual(page.games.count, 2)

        let card = page.games[0]
        XCTAssertEqual(card.id, 412)
        XCTAssertEqual(card.game.speed, .blitz)
        XCTAssertEqual(card.game.opening, "Ruy Lopez")
        XCTAssertEqual(card.game.playedAt, utc(2026, 8, 22, 19, 4, 11))
        XCTAssertEqual(card.analyzed, true)
        XCTAssertEqual(card.deep, false)
        XCTAssertEqual(card.evalCurve?.count, 3)
        XCTAssertEqual(card.evalCurve?[1].win, 43.2)
        // A curve point whose win percentage was dropped is still a point on the ply axis.
        XCTAssertEqual(card.evalCurve?[2].ply, 2)
        XCTAssertNil(card.evalCurve?[2].win)
        XCTAssertEqual(card.worstMoments?.first?.classification, .blunder)
        // Both the curve and the moments are on the move's own 0-based ply, which is what
        // lets the sparkline tick a flag against the curve drawn beside it.
        XCTAssertEqual(card.worstMoments?.first?.ply, 23)
        XCTAssertEqual(card.worstMoments?.first?.moveNumber, 12, "23 / 2 + 1")
        XCTAssertEqual(card.worstMoments?.first?.winLoss, 31.5)

        // The second row is what the card fields look like when the backend has nothing to
        // say about a game: absent, not empty.
        let bare = page.games[1]
        XCTAssertEqual(bare.id, 413)
        XCTAssertNil(bare.analyzed)
        XCTAssertNil(bare.evalCurve)
        XCTAssertNil(bare.worstMoments)
    }

    // MARK: Moves

    func testUnanalysedMoveDecodes() throws {
        let move = try decode(MoveRow.self, #"{"ply": 2, "san": "Nf3", "color": "white"}"#)

        XCTAssertEqual(move.ply, 2)
        XCTAssertEqual(move.san, "Nf3")
        XCTAssertNil(move.classification)
        XCTAssertNil(move.winBefore)
        XCTAssertNil(move.bestLines)
        XCTAssertNil(move.maia)
        XCTAssertFalse(move.isFlagged)
        XCTAssertNil(move.whiteWinAfter)
    }

    func testAnalysedMoveDecodesLinesAndMaia() throws {
        let json = """
        {
          "ply": 23,
          "move_number": 12,
          "color": "black",
          "san": "Nxe5",
          "uci": "f6e5",
          "clock": 84.3,
          "by_owner": true,
          "eval_before_cp": 21,
          "eval_after_cp": -310,
          "win_before": 52.1,
          "win_after": 20.6,
          "win_loss": 31.5,
          "classification": "blunder",
          "best_move_uci": "d7d6",
          "run_id": 9,
          "best_lines": [
            {"multipv": 1, "cp": 18, "pv": ["d7d6", "d2d4"], "san": ["d6", "d4"], "move_uci": "d7d6", "move_san": "d6"},
            {"multipv": 2, "mate": -4, "move_uci": "f6e5"}
          ],
          "maia": {
            "1700": [
              {"uci": "d7d6", "san": "d6", "rank": 2, "p": 0.21},
              {"uci": "f6e5", "san": "Nxe5", "rank": 1, "p": 0.43}
            ],
            "1500": [
              {"uci": "f6e5", "san": "Nxe5", "rank": 1}
            ],
            "not-a-rating": [
              {"uci": "a7a6"}
            ]
          }
        }
        """

        let move = try decode(MoveRow.self, json)

        XCTAssertEqual(move.classification, .blunder)
        XCTAssertTrue(move.isFlagged)
        XCTAssertEqual(move.evalAfterCp, -310)
        XCTAssertNil(move.evalAfterMate)
        XCTAssertEqual(move.bestLines?.count, 2)
        XCTAssertEqual(move.bestLines?[0].pv, ["d7d6", "d2d4"])
        XCTAssertEqual(move.bestLines?[1].mate, -4)
        XCTAssertNil(move.bestLines?[1].cp)

        // String keys became Int keys, the unreadable band was skipped rather than throwing,
        // and each band came back best-ranked first however it arrived.
        let maia = try XCTUnwrap(move.maia)
        XCTAssertEqual(maia.ratings, [1500, 1700])
        XCTAssertEqual(maia.moves(at: 1700).map(\.uci), ["f6e5", "d7d6"])
        XCTAssertEqual(maia.moves(at: 1700).first?.p, 0.43)
        XCTAssertEqual(maia.moves(at: 1500).count, 1)
        XCTAssertNil(maia.moves(at: 1500).first?.p)
        XCTAssertTrue(maia.moves(at: 1300).isEmpty)
    }

    func testWinPercentIsFlippedToWhiteOnBlackPlies() throws {
        let black = try decode(
            MoveRow.self,
            #"{"ply": 23, "color": "black", "win_before": 55, "win_after": 70}"#
        )
        // 70 for Black is 30 for White. A graph that plotted the raw number here would
        // mirror every black ply and still look like a plausible curve.
        XCTAssertEqual(black.whiteWinAfter, 30)
        XCTAssertEqual(black.whiteWinBefore, 45)

        let white = try decode(
            MoveRow.self,
            #"{"ply": 24, "color": "white", "win_before": 55, "win_after": 70}"#
        )
        XCTAssertEqual(white.whiteWinAfter, 70)
        XCTAssertEqual(white.whiteWinBefore, 55)

        // A row that lost its colour falls back to the ply's parity, and plies are numbered
        // from zero: an even ply is White's. Reading them as 1-based mirrors the graph.
        let noColour = try decode(MoveRow.self, #"{"ply": 23, "win_after": 70}"#)
        XCTAssertEqual(noColour.whiteWinAfter, 30)
        let noColourWhite = try decode(MoveRow.self, #"{"ply": 24, "win_after": 70}"#)
        XCTAssertEqual(noColourWhite.whiteWinAfter, 70)
    }

    /// The parity rule on its own, because it is the one thing in `MoveRow` that has to
    /// know how the backend numbers plies — everything else is told by `color`.
    func testAColourlessRowReadsItsSideOffTheZeroBasedPly() throws {
        XCTAssertTrue(try decode(MoveRow.self, #"{"ply": 0}"#).isWhiteMove, "ply 0 is 1.e4")
        XCTAssertFalse(try decode(MoveRow.self, #"{"ply": 1}"#).isWhiteMove)
        // `color` still wins where the server sent it, however odd the pairing looks.
        XCTAssertTrue(try decode(MoveRow.self, #"{"ply": 1, "color": "white"}"#).isWhiteMove)
    }

    // MARK: Game detail

    func testGameDetailDecodesBookWithIntKeys() throws {
        let json = """
        {
          "game": {"id": 412, "source": "lichess"},
          "ply_range": [0, 60],
          "moves": [{"ply": 0, "san": "e4", "color": "white"}],
          "runs": [
            {
              "id": 9,
              "tier": "deep",
              "status": "done",
              "engine": "Stockfish 17",
              "engine_kind": "uci",
              "nodes": 2000000,
              "multipv": 3,
              "finished_at": "2026-08-22T19:44:02.123456Z"
            }
          ],
          "book": {
            "6": {
              "games": 41,
              "wins": 22,
              "score": 0.61,
              "moves": [
                {"uci": "g1f3", "san": "Nf3", "games": 30, "wins": 18, "avg_win_loss": 3.4, "blunders": 1}
              ]
            },
            "8": {"games": 3}
          }
        }
        """

        let detail = try decode(GameDetail.self, json)

        XCTAssertEqual(detail.game.id, 412)
        XCTAssertEqual(detail.plyRange, [0, 60])
        XCTAssertEqual(detail.moves.count, 1)
        XCTAssertEqual(detail.move(atPly: 0)?.san, "e4", "ply 0 is White's first move")
        XCTAssertNil(detail.notes)
        XCTAssertEqual(detail.runs.first?.tier, "deep")
        XCTAssertEqual(detail.runs.first?.multipv, 3)
        XCTAssertNil(detail.runs.first?.maiaOnly)

        let book = try XCTUnwrap(detail.book)
        XCTAssertEqual(Set(book.keys), [6, 8])
        XCTAssertEqual(book[6]?.games, 41)
        XCTAssertEqual(book[6]?.moves?.first?.san, "Nf3")
        XCTAssertEqual(book[6]?.moves?.first?.avgWinLoss, 3.4)
        XCTAssertNil(book[8]?.moves)
    }

    func testGameDetailWithoutBookOrNotesDecodes() throws {
        let detail = try decode(
            GameDetail.self,
            #"{"game": {"id": 5, "source": "manual"}, "moves": [], "runs": []}"#
        )
        XCTAssertNil(detail.book)
        XCTAssertNil(detail.plyRange)
        XCTAssertTrue(detail.moves.isEmpty)
    }

    // MARK: Notes and auth

    func testNoteDecodesWithBriefs() throws {
        let json = """
        {
          "id": 3,
          "text": "stop playing this",
          "tags": ["ruy", "opening"],
          "game_id": 412,
          "ply": 24,
          "source": "web",
          "scope": "game",
          "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
          "created_at": "2026-08-22T19:44:02Z",
          "updated_at": "2026-08-22T19:44:02Z",
          "game": {"id": 412, "white": "phib", "black": "someone", "date": "2026-08-22"},
          "move": {"ply": 24, "move_number": 12, "san": "Nxe5", "label": "12... Nxe5", "classification": "blunder"}
        }
        """

        let note = try decode(NoteResponse.self, json)

        XCTAssertEqual(note.id, 3)
        XCTAssertEqual(note.tags, ["ruy", "opening"])
        XCTAssertEqual(note.game?.white, "phib")
        // The brief carries a plain day rather than a timestamp, so it stays a string and the
        // timestamp field stays nil instead of taking the note's decode down with it.
        XCTAssertEqual(note.game?.date, "2026-08-22")
        XCTAssertNil(note.game?.playedAt)
        // A note's ply is a half-move count, and the brief repeats it rather than converting
        // it — the move it names is the one at 23, which is why the label reads 12... and
        // not 13. Anything spelling this itself has to subtract one first.
        XCTAssertEqual(note.ply, 24)
        XCTAssertEqual(note.move?.ply, note.ply)
        XCTAssertEqual(note.move?.label, "12... Nxe5")
        XCTAssertEqual(Format.move(ply: (note.ply ?? 0) - 1, san: note.move?.san), "12… Nxe5")
        XCTAssertEqual(note.move?.classification, .blunder)
        XCTAssertEqual(note.createdAt, utc(2026, 8, 22, 19, 44, 2))
    }

    func testBareNoteDecodes() throws {
        let note = try decode(NoteResponse.self, #"{"id": 11, "text": "think about knights"}"#)
        XCTAssertNil(note.tags)
        XCTAssertNil(note.gameID)
        XCTAssertNil(note.game)
        XCTAssertNil(note.move)
        XCTAssertNil(note.createdAt)
    }

    func testAuthStatusDecodes() throws {
        let json = """
        {
          "setup_required": false,
          "authenticated": true,
          "capabilities": {"password_auth": true, "mcp": true, "remote_runners": false, "read_only": false},
          "maia_target_elo": 1700,
          "maia_elos": [1500, 1700]
        }
        """

        let status = try decode(AuthStatus.self, json)

        XCTAssertTrue(status.authenticated)
        XCTAssertFalse(status.setupRequired)
        XCTAssertEqual(status.capabilities?.readOnly, false)
        XCTAssertEqual(status.maiaTargetOrDefault, 1700)
        XCTAssertEqual(status.maiaElos, [1500, 1700])
    }

    func testAuthStatusWithoutMaiaFallsBackToTheBackendDefault() throws {
        let status = try decode(AuthStatus.self, #"{"setup_required": true, "authenticated": false}"#)
        XCTAssertTrue(status.setupRequired)
        XCTAssertNil(status.capabilities)
        XCTAssertEqual(status.maiaTargetOrDefault, AuthStatus.defaultMaiaTargetElo)
    }

    // MARK: Dates

    func testBothTimestampFormsParse() throws {
        let plain = try decode(
            GameSummary.self,
            #"{"id": 1, "source": "lichess", "played_at": "2026-08-22T19:04:11Z"}"#
        )
        XCTAssertEqual(plain.playedAt, utc(2026, 8, 22, 19, 4, 11))

        let fractional = try decode(
            GameSummary.self,
            #"{"id": 1, "source": "lichess", "played_at": "2026-08-22T19:04:11.123456Z"}"#
        )
        let seconds = try XCTUnwrap(fractional.playedAt).timeIntervalSince(utc(2026, 8, 22, 19, 4, 11))
        XCTAssertEqual(seconds, 0.123456, accuracy: 0.0005)

        // Written without a zone by an older import: read as UTC, not as the phone's zone.
        let zoneless = try decode(
            GameSummary.self,
            #"{"id": 1, "source": "lichess", "played_at": "2026-08-22T19:04:11"}"#
        )
        XCTAssertEqual(zoneless.playedAt, utc(2026, 8, 22, 19, 4, 11))

        // An offset other than Z is still an instant.
        let offset = try decode(
            GameSummary.self,
            #"{"id": 1, "source": "lichess", "played_at": "2026-08-22T21:04:11+02:00"}"#
        )
        XCTAssertEqual(offset.playedAt, utc(2026, 8, 22, 19, 4, 11))
    }

    func testAnUnreadableTimestampFails() {
        XCTAssertThrowsError(
            try decode(GameSummary.self, #"{"id": 1, "source": "lichess", "played_at": "last tuesday"}"#)
        )
    }

    // MARK: Unknown vocabulary

    func testUnknownVocabularyDecodesRatherThanThrowing() throws {
        let game = try decode(
            GameSummary.self,
            #"{"id": 1, "source": "chessbase", "speed": "hyperbullet"}"#
        )
        XCTAssertEqual(game.source, .unknown)
        XCTAssertEqual(game.speed, .unknown)

        let move = try decode(MoveRow.self, #"{"ply": 4, "classification": "dubious"}"#)
        XCTAssertEqual(move.classification, .unknown)
        // A word this build cannot read is not a mistake, and must not be flagged as one.
        XCTAssertFalse(move.isFlagged)
    }

    func testClassificationSeverityOrdersWorstFirst() {
        let sorted = [Classification.good, .blunder, .inaccuracy, .mistake]
            .sorted { $0.severity > $1.severity }
        XCTAssertEqual(sorted, [.blunder, .mistake, .inaccuracy, .good])
    }

    // MARK: Errors

    func testErrorBodiesMapToTheCaseTheAppActsOn() {
        let unauthorized = Data(#"{"error":"unauthorized","detail":"Sign in first."}"#.utf8)
        guard case .unauthorized = APIError.from(status: 401, data: unauthorized) else {
            return XCTFail("401 unauthorized should map to .unauthorized")
        }

        // The same status, a different screen: this server has no password yet.
        let setup = Data(#"{"error":"setup_required","detail":"Set a password."}"#.utf8)
        guard case .setupRequired = APIError.from(status: 401, data: setup) else {
            return XCTFail("401 setup_required should map to .setupRequired")
        }

        let readOnly = Data(#"{"error":"read_only","detail":"This demo is read-only."}"#.utf8)
        guard case .readOnly = APIError.from(status: 403, data: readOnly) else {
            return XCTFail("403 read_only should map to .readOnly")
        }

        guard case .notFound = APIError.from(status: 404, data: nil) else {
            return XCTFail("404 should map to .notFound")
        }

        // A body that is not our shape at all — a proxy's HTML, say — still has to produce
        // something a screen can show.
        guard case let .server(status, name, message) = APIError.from(status: 502, data: Data("<html>".utf8))
        else {
            return XCTFail("502 should map to .server")
        }
        XCTAssertEqual(status, 502)
        XCTAssertNil(name)
        XCTAssertNil(message)
    }

    func testTheMessageOnAServerErrorIsTheOneTheBackendWrote() {
        let body = Data(#"{"error":"conflict","detail":"That run is already queued."}"#.utf8)
        let error = APIError.from(status: 409, data: body)
        XCTAssertEqual(error.name, "conflict")
        XCTAssertEqual(error.localizedDescription, "That run is already queued.")
    }

    func testEveryErrorCaseSaysSomething() {
        let errors: [APIError] = [
            .unauthorized,
            .setupRequired,
            .readOnly,
            .notFound,
            .server(status: 500, name: nil, message: nil),
            .transport(URLError(.notConnectedToInternet)),
            .decoding(DecodingError.valueNotFound(Int.self, .init(codingPath: [], debugDescription: ""))),
        ]
        for error in errors {
            XCTAssertFalse(error.localizedDescription.isEmpty, "\(error) has nothing to show")
        }
    }
}
