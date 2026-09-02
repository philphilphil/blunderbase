/**
 * A reference game, shaped like a library game so the studio can show it.
 *
 * The studio (`GamePage`) used to be the only rich view of a game, and a model game from
 * the masters or lichess books got a reduced viewer of its own — a board, a movetext and
 * nothing else. That was the wrong trade. Everything the studio does that is worth doing to
 * somebody else's game works off the *position*, not off the library row: the live engine
 * search, Maia's read of the position, the analysis board a piece can be dragged on, the
 * opening book. A separate viewer meant none of that, and it meant two places to fix every
 * time the game view got better.
 *
 * So the studio takes its game from either source, and this is the seam. What a reference
 * game does not have, it does not pretend to have: no evaluations, no classifications, no
 * runs, no notes, no book. Every one of those is optional on `MoveRow`/`GameDetail` already,
 * so the studio reads a model game as a game nobody has analysed yet — which is exactly what
 * it is — rather than as a special case threaded through every panel.
 *
 * **`id` is 0, and that is load-bearing.** A reference game is not a row in the library
 * (issue #3's wall), so there is no id to give it; 0 is the value that can never be a real
 * one, and the studio takes a null library id rather than this number wherever it would have
 * asked the server about the game. The one door through the wall is "Add to library", which
 * is a POST that returns a real game with a real id, and the studio then navigates to it.
 */
import type { GameDetail, GameSummary, MoveRow, ReferenceGame, ReferenceSource } from '@/lib/api/types'

/** The library source a book's games are filed under once imported, and shown as here. */
function sourceOf(source: ReferenceSource): GameSummary['source'] {
  return source === 'masters' ? 'masters' : 'lichess'
}

/** `"1-0"` and friends pass through; anything else is left unsaid rather than guessed at. */
function resultOf(result: string | undefined): string | null {
  return result === '1-0' || result === '0-1' || result === '1/2-1/2' ? result : null
}

/**
 * The year, month and day a PGN `Date` tag carries, as the ISO instant the rest of the app
 * formats. `????.??.??` and partial dates are common in the masters book, so anything that
 * is not a full date is dropped — a game dated "1997" is better shown with no date than
 * with an invented first of January.
 */
function playedAt(date: string | null | undefined): string | null {
  const match = /^(\d{4})[.-](\d{2})[.-](\d{2})$/.exec(date ?? '')
  if (!match) return null
  const [, year, month, day] = match
  const stamp = Date.parse(`${year}-${month}-${day}T00:00:00Z`)
  return Number.isNaN(stamp) ? null : new Date(stamp).toISOString()
}

export function referenceDetail(game: ReferenceGame | undefined): GameDetail | undefined {
  if (!game) return undefined

  const summary: GameSummary = {
    id: 0,
    source: sourceOf(game.source),
    source_id: game.id,
    played_at: playedAt(game.date),
    // No colour: the owner did not play in this game, which is the same thing
    // `is_owner_game: false` says about it once it is imported.
    color: null,
    is_owner_game: false,
    result: resultOf(game.result),
    white: game.white.name,
    black: game.black.name,
    white_rating: game.white.rating ?? null,
    black_rating: game.black.rating ?? null,
    // The header bar's title slot. A model game carries no opening name — the explorer
    // knows the opening of the *position*, not of the game — and the event is both the
    // most informative thing it does carry and the thing a chess player would title it
    // with. It is replaced by a real opening name once the game is imported and analysed.
    opening: game.event ?? null,
    ply_count: game.moves.length,
  }

  const moves: MoveRow[] = game.moves.map((move) => ({
    ply: move.ply,
    move_number: Math.floor(move.ply / 2) + 1,
    color: move.ply % 2 === 0 ? 'white' : 'black',
    san: move.san,
    uci: move.uci,
  }))

  return { game: summary, moves, runs: [], notes: [] }
}
