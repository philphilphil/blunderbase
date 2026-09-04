import Foundation
@testable import Blunderbase

/// One real game, shared by every test that needs a game.
///
/// It is the Fried Liver trap — 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 5.exd5 Nxd5?? 6.Nxf7 —
/// because it is short enough to read in a test failure and still has everything the screen
/// draws: both colours, clocks, a capture, a blunder with a classification, engine lines
/// that disagree with the move played, and Maia at two levels agreeing with the blunder.
///
/// It also carries a book at two of its positions — half-move counts 4 and 8, keyed as the
/// server keys them, by **count** and as strings — each with the move this game played among
/// its continuations. Two entries rather than one because the pane has to be nil somewhere
/// as well as somewhere, and the gap between them (count 5, 6, 7) is what a test stands in.
///
/// The JSON is written in the shape the server really sends: absent keys rather than nulls,
/// win percentages from the point of view of the side that moved, and **plies numbered from
/// zero** — ply 0 is 1.e4, ply 9 is the blunder 5…Nxd5, `move_number` is `ply / 2 + 1` and an
/// even ply is White's. Building the structs directly would skip the decoder, which is half
/// of what these tests are checking; numbering the plies from one, which this fixture used
/// to do, made every ply-keyed assertion agree with data no server ever sends.
enum GameFixture {

    static func friedLiver() throws -> GameDetail {
        try APIClient.makeDecoder().decode(GameDetail.self, from: Data(json.utf8))
    }

    static let json = """
    {
      "game": {
        "id": 1,
        "source": "lichess",
        "played_at": "2026-08-22T19:04:11Z",
        "color": "white",
        "result": "1-0",
        "outcome": "win",
        "white": "phib",
        "black": "opponent",
        "white_rating": 1690,
        "black_rating": 1712,
        "eco": "C57",
        "opening": "Italian Game: Two Knights Defense, Fried Liver Attack",
        "time_control": "600+0",
        "speed": "rapid",
        "ply_count": 11
      },
      "moves": [
        {"ply": 0, "move_number": 1, "color": "white", "san": "e4", "uci": "e2e4", "clock": 598, "win_before": 50, "win_after": 52, "classification": "good"},
        {"ply": 1, "move_number": 1, "color": "black", "san": "e5", "uci": "e7e5", "clock": 597},
        {"ply": 2, "move_number": 2, "color": "white", "san": "Nf3", "uci": "g1f3", "clock": 594},
        {"ply": 3, "move_number": 2, "color": "black", "san": "Nc6", "uci": "b8c6", "clock": 590},
        {"ply": 4, "move_number": 3, "color": "white", "san": "Bc4", "uci": "f1c4", "clock": 585},
        {"ply": 5, "move_number": 3, "color": "black", "san": "Nf6", "uci": "g8f6", "clock": 580},
        {"ply": 6, "move_number": 4, "color": "white", "san": "Ng5", "uci": "f3g5", "clock": 571},
        {"ply": 7, "move_number": 4, "color": "black", "san": "d5", "uci": "d7d5", "clock": 559},
        {"ply": 8, "move_number": 5, "color": "white", "san": "exd5", "uci": "e4d5", "clock": 550, "win_before": 58, "win_after": 55, "classification": "best"},
        {
          "ply": 9, "move_number": 5, "color": "black", "san": "Nxd5", "uci": "f6d5", "clock": 44,
          "win_before": 45, "win_after": 8, "win_loss": 37, "classification": "blunder",
          "best_move_uci": "c6a5",
          "best_lines": [
            {"multipv": 1, "cp": -40, "pv": ["c6a5", "c4b5", "c7c6"], "san": ["Na5", "Bb5+", "c6"], "move_uci": "c6a5", "move_san": "Na5"},
            {"multipv": 2, "cp": -150, "pv": ["c8e6"], "san": ["Be6"], "move_uci": "c8e6", "move_san": "Be6"}
          ],
          "maia": {
            "1500": [{"uci": "f6d5", "san": "Nxd5", "rank": 1, "p": 0.61}, {"uci": "c6a5", "san": "Na5", "rank": 2, "p": 0.14}],
            "1700": [{"uci": "f6d5", "san": "Nxd5", "rank": 1, "p": 0.48}, {"uci": "d8d5", "san": "Qxd5", "rank": 2, "p": 0.21}]
          }
        },
        {"ply": 10, "move_number": 6, "color": "white", "san": "Nxf7", "uci": "g5f7", "clock": 540, "win_before": 92, "win_after": 88, "classification": "best"}
      ],
      "runs": [
        {"id": 4, "tier": "deep", "status": "done", "engine": "Stockfish 17", "engine_kind": "uci", "depth": 22, "multipv": 2}
      ],
      "notes": [],
      "book": {
        "4": {
          "games": 14, "wins": 8, "draws": 2, "losses": 4, "score": 0.6428571,
          "moves": [
            {"uci": "f1c4", "san": "Bc4", "games": 9, "wins": 6, "draws": 1, "losses": 2, "score": 0.7222222, "owner_moves": 9, "evaluated": 9, "avg_win_loss": 2.1, "blunders": 0},
            {"uci": "f1b5", "san": "Bb5", "games": 3, "wins": 1, "draws": 1, "losses": 1, "score": 0.5, "owner_moves": 3, "evaluated": 3, "avg_win_loss": 4.8, "blunders": 1},
            {"uci": "d2d4", "san": "d4", "games": 2, "wins": 1, "draws": 0, "losses": 1, "score": 0.5, "owner_moves": 2, "evaluated": 0}
          ]
        },
        "8": {
          "games": 5, "wins": 2, "draws": 1, "losses": 2, "score": 0.5,
          "moves": [
            {"uci": "e4d5", "san": "exd5", "games": 3, "wins": 2, "draws": 0, "losses": 1, "score": 0.6666667, "owner_moves": 3, "evaluated": 3, "avg_win_loss": 1.4, "blunders": 0},
            {"uci": "c4d5", "san": "Bxd5", "games": 2, "wins": 0, "draws": 1, "losses": 1, "score": 0.25, "owner_moves": 2, "evaluated": 2, "avg_win_loss": 9.2, "blunders": 1}
          ]
        }
      }
    }
    """
}
