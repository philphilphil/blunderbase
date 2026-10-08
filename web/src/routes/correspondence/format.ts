/**
 * The words and the cuts the correspondence screens are made of: whose game it is, when
 * the reply is due, and which of the three sections a row belongs in.
 *
 * Everything here is a pure function of a `CorrespondenceGameSummary`, so the list page and
 * the game header cannot disagree about what "in 3 days" means or about who the opponent
 * is — and so both can be tested without a DOM.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg, plural } from '@lingui/core/macro'

import type {
  Color,
  CorrespondenceGameSummary,
  CorrespondenceMark,
  CorrespondenceTreeNode,
} from '@/lib/api/types'
import { writeDate, writeDayMonth, type DateFormat } from '@/lib/i18n/dateFormat'

/** The three cuts of the list, in the order the page prints them. */
export interface CorrespondenceSections {
  /** Waiting on the owner, soonest due first — the backend's own order, kept. */
  yourMove: CorrespondenceGameSummary[]
  waiting: CorrespondenceGameSummary[]
  finished: CorrespondenceGameSummary[]
}

/**
 * One ordering with two cuts in it, as the contract promises: the list arrives sorted and
 * the page only decides which heading each row falls under. Sorting again here would be a
 * second opinion about the same question.
 */
export function sections(games: readonly CorrespondenceGameSummary[]): CorrespondenceSections {
  const yourMove: CorrespondenceGameSummary[] = []
  const waiting: CorrespondenceGameSummary[] = []
  const finished: CorrespondenceGameSummary[] = []
  for (const game of games) {
    if (game.finished || game.state === 'finished') finished.push(game)
    else if (game.your_move) yourMove.push(game)
    else waiting.push(game)
  }
  return { yourMove, waiting, finished }
}

/**
 * The games either side of this one, walking the list the way it reads: **Your move**, then
 * **Waiting for the opponent**. The finished games are not in the walk, because the list
 * opens those in the library rather than here. Null for a game the walk does not hold.
 *
 * Asked of the list as it is now, not as it was when the game was opened: playing a move
 * moves the game from one section to the other, and "next" is whatever the list would put
 * below it after that.
 */
export function neighbours(
  games: readonly CorrespondenceGameSummary[],
  gameId: number,
): { previous: number | null; next: number | null } | null {
  const cut = sections(games)
  const walk = [...cut.yourMove, ...cut.waiting]
  const at = walk.findIndex((game) => game.game_id === gameId)
  if (at < 0) return null
  return {
    previous: walk[at - 1]?.game_id ?? null,
    next: walk[at + 1]?.game_id ?? null,
  }
}

/** The other player — the one the row is named after. */
export function opponentOf(game: CorrespondenceGameSummary): string {
  return game.owner_color === 'black' ? game.white : game.black
}

export function ownerName(game: CorrespondenceGameSummary): string {
  return game.owner_color === 'black' ? game.black : game.white
}

export function opponentRating(game: CorrespondenceGameSummary): number | null {
  return (game.owner_color === 'black' ? game.white_rating : game.black_rating) ?? null
}

/** Which side the owner is, defaulting to White only where the game names nobody. */
export function ownerColor(game: CorrespondenceGameSummary): Color {
  return game.owner_color === 'black' ? 'black' : 'white'
}

/** How urgent the deadline is, which is what gives the due cell its colour. */
export type DueTone = 'late' | 'soon' | 'calm' | 'none'

/**
 * Under two days is amber and past due is red — the design's rule, and the only two
 * distinctions a deadline needs. A game with no deadline has no tone at all.
 */
export function dueTone(game: CorrespondenceGameSummary): DueTone {
  const days = game.days_left
  if (game.finished || days === null || days === undefined) return 'none'
  if (days < 0) return 'late'
  return days < 2 ? 'soon' : 'calm'
}

/**
 * The deadline in words, as a message plus its values — the caller renders it, so the
 * sentence is in the reader's language rather than in whichever one the tab was opened in.
 */
export interface DuePhrase {
  message: MessageDescriptor
  values: { days: number }
}

/**
 * `in 3 days`, `today`, `2 days late`. Rounded away from zero for the late side and towards
 * it for the near side, so "in 0 days" — which is a deadline that has not passed — never
 * appears and reads as `today` instead.
 *
 * Both counted sentences are plurals rather than templates with a number dropped in: one
 * day is the commonest deadline there is on this screen, and "in 1 days" is a sentence no
 * language writes.
 */
export function duePhrase(daysLeft: number | null | undefined): DuePhrase | null {
  if (daysLeft === null || daysLeft === undefined) return null
  if (daysLeft < 0) {
    const days = Math.ceil(-daysLeft)
    return {
      message: msg`${plural(days, { one: '# day late', other: '# days late' })}`,
      values: { days },
    }
  }
  const days = Math.floor(daysLeft)
  if (days < 1) return { message: msg`today`, values: { days: 0 } }
  return {
    message: msg`${plural(days, { one: 'in # day', other: 'in # days' })}`,
    values: { days },
  }
}

/**
 * A timestamp as a plain date in the reader's date format (`lib/i18n/dateFormat`): the day
 * and month alone for a reply due within weeks, the whole date with `year` for a game that
 * may have finished long ago. Empty for anything unparseable.
 */
export function shortDate(
  iso: string | null | undefined,
  format: DateFormat,
  { year = false }: { year?: boolean } = {},
): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return year ? writeDate(at, format) : writeDayMonth(at, format)
}

/** An ISO timestamp as the `yyyy-mm-dd` a native date input takes, in local time. */
export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * A `yyyy-mm-dd` from a date input back to an instant the backend can store.
 *
 * Midday local time rather than midnight: a deadline is a day, and midnight would land on
 * the day before in every timezone west of the server once it is written as UTC.
 */
export function dateInputToIso(value: string): string | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  const at = new Date(year, month - 1, day, 12, 0, 0)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/** The five marks and the glyph each prints as — the same table the PGN's NAGs come from. */
export const MARK_GLYPHS: Record<CorrespondenceMark, string> = {
  good: '!',
  interesting: '!?',
  dubious: '?!',
  bad: '?',
  excluded: '✕',
}

/** What a mark is called, for the context menu and the candidates table's header. */
export const MARK_LABELS: Record<CorrespondenceMark, MessageDescriptor> = {
  good: msg`Good`,
  interesting: msg`Interesting`,
  dubious: msg`Dubious`,
  bad: msg`Bad`,
  excluded: msg`Excluded`,
}

/** The colour each mark reads in — the classification hues, which they already mean. */
export const MARK_CLASS: Record<CorrespondenceMark, string> = {
  good: 'text-good',
  interesting: 'text-accent-teal',
  dubious: 'text-inaccuracy',
  bad: 'text-blunder',
  excluded: 'text-faint',
}

/**
 * One engine row, read as White's.
 *
 * The raw `evals` rows and the `best_lines` under them are stored the way `MoveEval`
 * stores a score, from the side to move's point of view, so with Black to move `+0.30`
 * means Black is better. Every number on the correspondence screens is printed from
 * White's point of view — the frame every evaluation bar, every engine panel and every
 * chess program uses, and the only one in which a column of numbers down a tree can be
 * read without flipping the sign on alternate rows. So a row is turned once here, by the
 * node's own `turn` — the hazard `lib/analysis/streamModel.ts` documents for the live
 * panel, answered the same way. The tree's `own` and `backed` come in the mover's frame
 * and go through `tree.ts`'s `inWhiteFrame` instead, by the node's `frame`.
 */
export function rowAsWhite<T extends { cp?: number | null; mate?: number | null }>(
  score: T | null | undefined,
  node: Pick<CorrespondenceTreeNode, 'turn'> | null | undefined,
): T | null {
  if (!score) return null
  if (!node || node.turn === 'white') return score
  return {
    ...score,
    cp: score.cp === null || score.cp === undefined ? score.cp : -score.cp,
    mate: score.mate === null || score.mate === undefined ? score.mate : -score.mate,
  } as T
}

/** `1 258 402` reads as an ICCF game number rather than as a quantity. */
export function iccfNumber(game: CorrespondenceGameSummary): string | null {
  return game.source === 'iccf' && game.source_id ? game.source_id : null
}
