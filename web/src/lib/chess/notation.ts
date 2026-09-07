/**
 * How a move is written: `Nc3`, `Sc3` or `♞c3`.
 *
 * Every move in the store is English SAN, because that is what PGN is, what the engines
 * speak and what the MCP client reads — a fact about the game, not about the reader. But
 * the letter in front of the square is the one part of chess notation that is a *word*: N
 * is for kNight, S is for Springer, and a German reader who learnt the game from German
 * books reads `Nc3` with a stutter. So the letters follow the UI language by default, and
 * figurines are there for whoever would rather have the piece than a letter for it, which
 * is how every printed book has done it for fifty years.
 *
 * One set of figurines rather than white ones for White and black ones for Black. The
 * glyph says *which piece*, and whose move it is the move number already says; two sets
 * would make the reader decode the colour twice. The filled set, because the outlines
 * disappear at move-list sizes. The figurines stay *text* — they go into titles, labels
 * and translated sentences the same as a letter does — and are made legible by a font,
 * not by SVG: `index.css` pins a chess-only face (Noto Sans Symbols 2) to U+2654–265F at
 * the head of every stack, so `♞` renders from a glyph drawn for the purpose wherever it
 * appears, and the browser fetches that face only once a figurine is on screen.
 *
 * `formatSan` is safe on any string that is nothing but notation — a SAN, a numbered
 * variation, a PV — since the only capitals such a string can hold are piece letters
 * (castling is `O`, squares are lowercase). It is *not* safe on a sentence: `Nach 12.Sf3`
 * would lose its N. Format the move, then put it in the sentence.
 */
import type { Locale } from '@/lib/i18n/locale'

export type NotationStyle = 'english' | 'local' | 'figurines'

/** A move (or a run of moves) written the way the reader wants it — `useNotation`. */
export type Notate = (text: string) => string

/** The store's own English SAN, untouched: the default wherever no reader is in sight. */
export const notateEnglish: Notate = (text) => text

export const NOTATION_STYLES: readonly NotationStyle[] = ['english', 'local', 'figurines']

/** K Q R B N, in that order, as each language writes them. English is the source. */
const ENGLISH = 'KQRBN'
export const PIECE_LETTERS: Record<Locale, string> = {
  en: ENGLISH,
  de: 'KDTLS',
}

export const FIGURINES = '♚♛♜♝♞'

/** Whether the language writes its pieces differently from English — if not, the
 *  "letters in your language" choice is the English one and need not be offered. */
export function hasLocalLetters(locale: Locale): boolean {
  return PIECE_LETTERS[locale] !== ENGLISH
}

function alphabet(style: NotationStyle, locale: Locale): string {
  if (style === 'figurines') return FIGURINES
  if (style === 'local') return PIECE_LETTERS[locale]
  return ENGLISH
}

/** English SAN (or a run of it) rewritten in the chosen style. Identity for English letters. */
export function formatSan(text: string, style: NotationStyle, locale: Locale): string {
  const to = alphabet(style, locale)
  if (to === ENGLISH) return text
  return text.replace(/[KQRBN]/g, (letter) => to[ENGLISH.indexOf(letter)] ?? letter)
}
