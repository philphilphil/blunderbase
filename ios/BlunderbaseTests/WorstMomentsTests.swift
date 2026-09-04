import XCTest
@testable import Blunderbase

/// The worst-moments strip: when it is on screen, and where a tile lands.
///
/// Two rules carry the feature, and neither is visible in the view's body.
///
/// **It is absent over a narrowed library.** A search or a filter makes the games list an
/// answer to a question; six moments from the whole library sitting on top of that answer
/// are answering a different one, and a reader would have to notice that on their own.
///
/// **A tile opens the game on the position the move was played from.** The moment's `ply` is
/// a 0-based move ply, the cursor is a half-move count, and the two are the same number for
/// exactly this purpose: at cursor `ply` the flagged move is the `positionMove` — still to
/// come — and the engine's own move is on screen beside it. One off in either direction and
/// the tile lands on a plausible position that answers nothing.
@MainActor
final class WorstMomentsTests: XCTestCase {

    // MARK: When the strip is on screen

    func testTheStripIsHiddenWhileSomethingIsSearchedFor() throws {
        let games = GamesStore()
        let moments = MomentsStore()
        moments.adopt([try blunder()])
        XCTAssertTrue(moments.isVisible(over: games))

        games.search = "hikaru"
        XCTAssertTrue(games.hasFilters)
        XCTAssertFalse(moments.isVisible(over: games), "the list is an answer to a query now")
    }

    func testTheStripIsHiddenUnderAFilter() async throws {
        let games = GamesStore()
        let moments = MomentsStore()
        moments.adopt([try blunder()])

        await games.apply { $0.hasBlunders = true }
        XCTAssertFalse(moments.isVisible(over: games))

        await games.clearFilters()
        XCTAssertFalse(games.hasFilters)
        XCTAssertTrue(moments.isVisible(over: games))
    }

    /// Nothing in the window shows nothing at all — not an empty box saying so, which would
    /// cost the top of the list to report an absence.
    func testAnEmptyWindowDrawsNothingRatherThanAnEmptyState() {
        let moments = MomentsStore()
        moments.adopt([])
        XCTAssertFalse(moments.isVisible(over: GamesStore()))
    }

    /// Loading is the one state that draws without content: the skeleton is the shape the
    /// tiles will have, so the list does not jump when they land.
    func testTheSkeletonIsDrawnBeforeTheFirstAnswer() {
        XCTAssertTrue(MomentsStore().isVisible(over: GamesStore()))
    }

    // MARK: Where a tile lands

    /// The contract `GameDetailView(initialPly:)` is handed by a tile: seeking to the
    /// moment's own ply puts the flagged move *ahead* of the cursor.
    func testOpeningAMomentLandsOnThePositionTheBlunderWasPlayedFrom() throws {
        let store = GameStore(
            gameID: 1,
            endpoints: Endpoints(serverURL: URL(string: "https://example.invalid")!)
        )
        store.adopt(try GameFixture.friedLiver())

        let moment = try blunder()
        XCTAssertEqual(moment.ply, 9, "5… Nxd5 is the fixture's blunder")

        store.seek(to: moment.ply)

        XCTAssertEqual(store.cursor, moment.ply)
        XCTAssertEqual(store.positionMove?.san, moment.san, "the flagged move is still to come")
        XCTAssertEqual(store.positionMove?.classification, .blunder)
        XCTAssertEqual(store.playedMove?.san, "exd5", "and the move before it has been played")
        // What makes the position worth landing on: the engine's answer hangs on the move
        // played from here, so it is on screen the moment the tile opens.
        XCTAssertEqual(store.positionMove?.bestLines?.first?.moveSan, moment.bestMoveSan)
    }

    /// A note's ply is a half-move *count* rather than a move ply, and passes through to the
    /// cursor untouched — the same parameter, given a number that means something else.
    func testANotesPlyOpensAfterTheMoveItIsAbout() throws {
        let store = GameStore(
            gameID: 1,
            endpoints: Endpoints(serverURL: URL(string: "https://example.invalid")!)
        )
        store.adopt(try GameFixture.friedLiver())

        // A note written at count 10 is about the position 5… Nxd5 made.
        store.seek(to: 10)
        XCTAssertEqual(store.playedMove?.san, "Nxd5")
    }

    // MARK: Fixture

    /// The fixture game's blunder as `/stats/worst-moments` would hand it over, decoded
    /// rather than built, so the test rides on the same shape the app really reads.
    private func blunder() throws -> MomentResponse {
        let json = """
        {
          "game": {"id": 1, "source": "lichess", "played_at": "2026-08-22T19:04:11Z", "opponent": "opponent"},
          "ply": 9,
          "move_number": 5,
          "san": "Nxd5",
          "uci": "f6d5",
          "classification": "blunder",
          "win_loss": 37.0,
          "phase": "opening",
          "piece": "N",
          "fen": "r1bqkb1r/ppp2ppp/2n5/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5",
          "best_move_uci": "c6a5",
          "best_move_san": "Na5"
        }
        """
        return try APIClient.makeDecoder().decode(MomentResponse.self, from: Data(json.utf8))
    }
}
