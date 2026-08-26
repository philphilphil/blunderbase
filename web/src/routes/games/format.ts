/**
 * The small formatters design 2b's table cells need.
 *
 * They live here rather than in `src/lib` because they are the two screens' own
 * vocabulary — the opening explorer (design 2c) imports the game-shaped ones for its
 * "games in this line" list, and nothing else in the app uses them yet.
 */
import type { Classification, GameCard, GameSummary, Outcome, Source, Tier } from '@/lib/api/types'
import { glyphFor, type Glyph } from '@/lib/chess/classification'
import { MINUS } from '@/lib/chess/evaluation'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * `22 Aug` for a game from this year, `7 Dec 16` for an older one — the design's 78px
 * date column, which has no room for a full date but must not lie about the year.
 */
export function formatGameDate(
  played: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!played) return '—'
  const date = new Date(played)
  if (Number.isNaN(date.getTime())) return '—'
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`
  return date.getFullYear() === now.getFullYear()
    ? day
    : `${day} ${String(date.getFullYear() % 100).padStart(2, '0')}`
}

/** The PGN result with typographic glyphs: `1–0`, `0–1`, `½–½`. */
export function formatResult(result: string | null | undefined): string {
  switch (result) {
    case '1-0':
      return '1–0'
    case '0-1':
      return '0–1'
    case '1/2-1/2':
      return '½–½'
    case '*':
      return '*'
    default:
      return '—'
  }
}

/** Green when the owner won, red when they lost, grey for a draw — design 2b's Res column. */
export function outcomeTone(outcome: string | null | undefined): string {
  switch (outcome) {
    case 'win':
      return 'text-good'
    case 'loss':
      return 'text-blunder'
    case 'draw':
      return 'text-soft'
    default:
      return 'text-dim'
  }
}

/**
 * `600+0` -> `10+0`, `90+30` OTB -> `OTB 90+30`. A clock the backend stored in seconds is
 * shown in minutes the way every chess site writes it; anything unparseable is passed
 * through rather than mangled.
 */
export function formatTimeControl(game: Pick<GameSummary, 'time_control' | 'speed' | 'source'>): string {
  const prefix = game.source === 'manual' ? 'OTB ' : ''
  const raw = game.time_control
  if (!raw) return game.speed ? `${prefix}${SPEED_LABELS[game.speed] ?? game.speed}` : '—'
  const match = /^(\d+)\+(\d+)$/.exec(raw)
  if (!match) return `${prefix}${raw}`
  const seconds = Number(match[1])
  const increment = match[2]
  const base = seconds % 60 === 0 ? String(seconds / 60) : `${(seconds / 60).toFixed(1)}`
  return `${prefix}${base}+${increment}`
}

const SPEED_LABELS: Record<string, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Corr.',
}

/** The opening, with its ECO code split off so the code can be set in mono. */
export function splitOpening(game: Pick<GameSummary, 'opening' | 'eco'>): {
  name: string
  eco: string | null
} {
  return { name: game.opening ?? '—', eco: game.eco ?? null }
}

/** Whole moves rather than plies, which is what the design's `Mv` column counts. */
export function moveCount(plyCount: number | null | undefined): string {
  if (plyCount === null || plyCount === undefined) return '—'
  return String(Math.ceil(plyCount / 2))
}

/** The largest win percentage the owner gave away in a game, or null if nothing is analysed. */
export function worstDrop(game: GameCard): number | null {
  const worst = game.worst_moments?.[0]?.win_loss
  return typeof worst === 'number' ? worst : null
}

/** `−58%` in the colour of the classification that earned it. */
export function formatDrop(drop: number | null): string {
  if (drop === null) return '—'
  return `${MINUS}${Math.round(drop)}%`
}

/** How a drop is coloured: the design paints the ACPL column by severity. */
export function dropTone(drop: number | null): string {
  if (drop === null) return 'text-dim-2'
  if (drop >= 30) return 'text-blunder'
  if (drop >= 15) return 'text-mistake'
  if (drop >= 7) return 'text-inaccuracy'
  return 'text-good'
}

/**
 * The Flags cell of design 2b: one chip per class carrying its glyph and how many of them
 * the row has — `??1 ?2 ?!5`, worst class first, never one chip per move.
 *
 * `/games?cards=true` carries the three worst moments per game (`services/games.py:
 * game_card`, `worst=3`), so the counts are over those three: three blunders read `??3`.
 */
export interface FlagCount {
  glyph: Glyph
  count: number
}

const FLAG_ORDER: readonly Glyph[] = ['blunder', 'mistake', 'inaccuracy']

export function flagCounts(game: GameCard): FlagCount[] {
  const counts = new Map<Glyph, number>()
  for (const moment of game.worst_moments ?? []) {
    const glyph = glyphFor((moment as { classification?: Classification }).classification)
    if (!glyph) continue
    counts.set(glyph, (counts.get(glyph) ?? 0) + 1)
  }
  return FLAG_ORDER.filter((glyph) => counts.has(glyph)).map((glyph) => ({
    glyph,
    count: counts.get(glyph)!,
  }))
}

/** Which analysis tier a card carries, or null when nothing has run over it. */
export function tierOf(game: GameCard): Tier | null {
  if (game.deep) return 'deep'
  if (game.analyzed) return 'quick'
  return null
}

/** The sort rank of a tier: unanalysed < quick < deep. */
export function tierRank(game: GameCard): number {
  return game.deep ? 2 : game.analyzed ? 1 : 0
}

export const SOURCE_LABELS: Record<Source, string> = {
  lichess: 'Lichess',
  chesscom: 'Chess.com',
  manual: 'OTB',
  pgn: 'PGN',
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
}

/** `1,284` — every count in the design is grouped. */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}
