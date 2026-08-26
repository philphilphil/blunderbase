/**
 * The game as PGN, assembled from the `/games/{id}` payload.
 *
 * The API has no PGN export — the import side takes PGN in, nothing sends it back out — but
 * the payload carries everything the format needs: the seven-tag roster comes off
 * `GameSummary` and the movetext off the SAN in the move rows. So design 1a's `PGN`
 * affordance is answered here rather than by an endpoint that does not exist.
 *
 * Unknown tag values are `?` and an unknown date is `????.??.??`, which is what the standard
 * says and what every reader expects.
 */
import type { GameSummary, MoveRow } from '@/lib/api/types'

const UNKNOWN = '?'
/** The export format wraps movetext at 80 columns. */
const WRAP = 80

const SITES: Record<string, string> = {
  lichess: 'lichess.org',
  chesscom: 'chess.com',
}

/** `"a \"quoted\" name"` — the only two characters PGN escapes inside a tag value. */
function tagValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function tag(name: string, value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : value
  if (text === null || text === undefined || text === '') return null
  return `[${name} "${tagValue(String(text))}"]`
}

/** `2016-12-07T12:28:49Z` -> `2016.12.07`. */
export function pgnDate(played: string | null | undefined): string {
  if (!played) return '????.??.??'
  const value = new Date(played)
  if (Number.isNaN(value.getTime())) return '????.??.??'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${value.getFullYear()}.${pad(value.getMonth() + 1)}.${pad(value.getDate())}`
}

/** `1. e4 d5 2. exd5 Qxd5`, wrapped the way the export format wraps it. */
export function pgnMovetext(moves: MoveRow[], result: string): string {
  const tokens: string[] = []
  for (const move of moves) {
    if (!move.san) continue
    if (move.ply % 2 === 0) tokens.push(`${Math.floor(move.ply / 2) + 1}.`)
    tokens.push(move.san)
  }
  tokens.push(result)

  const lines: string[] = []
  let line = ''
  for (const token of tokens) {
    if (line === '') line = token
    else if (line.length + 1 + token.length <= WRAP) line = `${line} ${token}`
    else {
      lines.push(line)
      line = token
    }
  }
  if (line !== '') lines.push(line)
  return lines.join('\n')
}

/** `Rated Rapid game` — what the sources themselves put in the Event tag. */
function eventName(game: GameSummary): string {
  if (!game.speed) return UNKNOWN
  const speed = game.speed[0].toUpperCase() + game.speed.slice(1)
  if (game.rated === null || game.rated === undefined) return `${speed} game`
  return `${game.rated ? 'Rated' : 'Casual'} ${speed} game`
}

export function buildPgn(game: GameSummary, moves: MoveRow[]): string {
  const result = game.result && game.result !== '' ? game.result : '*'
  const lines = [
    tag('Event', eventName(game)),
    tag('Site', (game.source ? SITES[game.source] : null) ?? UNKNOWN),
    `[Date "${pgnDate(game.played_at)}"]`,
    tag('Round', UNKNOWN),
    tag('White', game.white ?? UNKNOWN),
    tag('Black', game.black ?? UNKNOWN),
    tag('Result', result),
    tag('WhiteElo', game.white_rating?.toString()),
    tag('BlackElo', game.black_rating?.toString()),
    tag('ECO', game.eco),
    tag('Opening', game.opening),
    tag('TimeControl', game.time_control),
    tag('Termination', game.termination),
    game.variant && game.variant !== 'standard' ? tag('Variant', game.variant) : null,
  ].filter((entry): entry is string => entry !== null)

  return `${lines.join('\n')}\n\n${pgnMovetext(moves, result)}\n`
}
