/**
 * Every keyboard shortcut in the app, written down once.
 *
 * The reason this is a table and not a comment somewhere is the overlay. A shortcut list
 * that is maintained by hand beside the handlers goes stale the first time a key moves,
 * and a printed list that lies is worse than none — the reader presses the key, nothing
 * happens, and now they distrust the rest of it. So the overlay reads this, and the board
 * handler (`routes/game/useBoardKeys.ts`) dispatches from this: one row is both the
 * binding and the sentence about it, and there is nowhere for the two to disagree.
 *
 * `press` is what the browser reports as `event.key`; `keys` is what the overlay prints.
 * They are separate on purpose — `ArrowLeft` is not something to show a reader, and `f`
 * and `F` are one shortcut with two spellings rather than two rows in a list. A binding
 * that wants Shift writes it as a `shift+` prefix, which is how `chordOf` spells a
 * keystroke: a letter already carries Shift in its own `event.key` (`j` becomes `J`), an
 * arrow does not, and one spelling for both is what stops that difference leaking into
 * every handler.
 *
 * The shell's own bindings (⌘K, ⌘1–5) are listed but not dispatched from here: they live
 * in the components that own the dialogs and the router, and lifting them out would move
 * code that works to serve a list. What this table owes them is an accurate line.
 */

/**
 * Typing in a field is never a shortcut.
 *
 * Here rather than beside any one handler because every one of them needs it — the board,
 * the games table, the explorer, the help overlay — and a second spelling of "is the
 * reader writing something" is a second place for a key to be stolen from a text box.
 */
export function isTyping(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  return !!element?.closest('input, textarea, select, [contenteditable="true"]')
}

/** What a board shortcut asks the game view to do. */
export type BoardAction =
  | 'step-back'
  | 'step-forward'
  | 'seek-start'
  | 'seek-end'
  | 'next-flagged'
  | 'previous-flagged'
  | 'flip'
  | 'toggle-hints'
  | 'toggle-engine'
  | 'note'
  | 'exit-line'
  | 'jump-back'
  | 'jump-forward'
  | 'play-best'
  | 'board-settings'
  | 'queue-quick'
  | 'queue-deep'
  | 'copy-pgn'
  | 'toggle-move-tab'
  | 'autoplay'
  | 'previous-game'
  | 'next-game'

export interface Shortcut {
  /** What is pressed, as the overlay prints it. One chip per entry. */
  keys: string[]
  /** What it does, in the overlay's words — a phrase, not a sentence. */
  label: string
}

/**
 * Which heading a board shortcut is printed under.
 *
 * The game view has more keys than any other screen — enough that one list of them is a
 * wall to be searched rather than a thing to be read — so they are filed by what the hand
 * is doing: getting somewhere in the game, changing what the board says, or acting on the
 * game itself. The section is on the shortcut rather than in the overlay so that adding a
 * key still means editing exactly one row.
 */
export type BoardSection = 'Moving about the game' | 'The board' | 'The game itself'

export interface BoardShortcut extends Shortcut {
  /** The `event.key` values that fire it. */
  press: string[]
  action: BoardAction
  section: BoardSection
}

/**
 * How far ⇧← and ⇧→ travel.
 *
 * Five plies rather than ten: a jump is for crossing an opening you have read before, and
 * one that lands two and a half moves away is one you can steer with — ten is far enough
 * that you overshoot and come back, which is two gestures where the arrows were one.
 */
export const JUMP = 5

const MOVING = 'Moving about the game' as const
const BOARD = 'The board' as const
const GAME = 'The game itself' as const

/** The order the overlay prints the game's sections in. */
export const BOARD_SECTIONS: BoardSection[] = [MOVING, BOARD, GAME]

/**
 * The game view's keys.
 *
 * Ordered as a hand would learn them: move about the game first, then how the board is
 * drawn, then what to do to the position. The overlay prints them in this order and so
 * does the transport row's grouping, which is the same argument made in pixels.
 *
 * The four arrows are the whole point of the page under one hand: sideways steps a move,
 * and up and down jump between the moves worth stopping at. Down is forwards, as it is for
 * the wheel over the board and over the engine lines. Home / End keep the ends of the game,
 * which is where the arrows used to go.
 *
 * `,` and `.` jump between flagged moves beside the arrows — the prev/next pair every video
 * player uses, unshifted, symmetric and adjacent under one finger. They replace the `j` /
 * `⇧J` this screen used to carry: a jump backwards is worth as little effort as a jump
 * forwards, and one of those two needed Shift.
 *
 * `Escape` leaves an analysis line rather than doing nothing at the end of one. It is the
 * only key here that is also a browser-wide idiom, and it means the same thing here as it
 * does everywhere else: back out of what you stepped into.
 */
export const BOARD_SHORTCUTS: BoardShortcut[] = [
  // Moving about the game.
  { section: MOVING, action: 'step-back', press: ['ArrowLeft'], keys: ['←'], label: 'One move back' },
  {
    section: MOVING,
    action: 'step-forward',
    press: ['ArrowRight'],
    keys: ['→'],
    label: 'One move on',
  },
  {
    section: MOVING,
    action: 'previous-flagged',
    press: ['ArrowUp', ','],
    keys: ['↑', ','],
    label: 'The previous flagged move',
  },
  {
    section: MOVING,
    action: 'next-flagged',
    press: ['ArrowDown', '.'],
    keys: ['↓', '.'],
    label: 'The next flagged move',
  },
  {
    section: MOVING,
    action: 'jump-back',
    press: ['shift+ArrowLeft'],
    keys: ['⇧←'],
    label: `${JUMP} moves back`,
  },
  {
    section: MOVING,
    action: 'jump-forward',
    press: ['shift+ArrowRight'],
    keys: ['⇧→'],
    label: `${JUMP} moves on`,
  },
  {
    section: MOVING,
    action: 'seek-start',
    press: ['Home'],
    keys: ['Home'],
    label: 'The starting position',
  },
  { section: MOVING, action: 'seek-end', press: ['End'], keys: ['End'], label: 'The last move' },
  {
    section: MOVING,
    action: 'autoplay',
    press: [' '],
    keys: ['Space'],
    label: 'Play the game through',
  },
  {
    section: MOVING,
    action: 'previous-game',
    press: ['['],
    keys: ['['],
    label: 'Previous game in your games list',
  },
  {
    section: MOVING,
    action: 'next-game',
    press: [']'],
    keys: [']'],
    label: 'Next game in your games list',
  },

  // What the board draws, and what the engines are asked.
  { section: BOARD, action: 'flip', press: ['f', 'F'], keys: ['F'], label: 'Flip the board' },
  {
    section: BOARD,
    action: 'toggle-hints',
    press: ['h', 'H'],
    keys: ['H'],
    label: 'Hints — the board’s arrows and the engine columns',
  },
  {
    section: BOARD,
    action: 'toggle-engine',
    press: ['e', 'E'],
    keys: ['E'],
    label: 'The live engine on this position',
  },
  {
    section: BOARD,
    action: 'play-best',
    press: ['Enter'],
    keys: ['↵'],
    label: 'Play the engine’s move onto the board',
  },
  {
    section: BOARD,
    action: 'board-settings',
    press: ['s', 'S'],
    keys: ['S'],
    label: 'Board settings — arrows, sound, the eval graph',
  },
  { section: BOARD, action: 'exit-line', press: ['Escape'], keys: ['Esc'], label: 'Back to the game' },

  // Acting on the game.
  {
    section: GAME,
    action: 'note',
    press: ['n', 'N'],
    keys: ['N'],
    label: 'Write a note about this position',
  },
  {
    section: GAME,
    action: 'queue-quick',
    press: ['q', 'Q'],
    keys: ['Q'],
    label: 'Queue a quick pass',
  },
  { section: GAME, action: 'queue-deep', press: ['d', 'D'], keys: ['D'], label: 'Queue a deep pass' },
  { section: GAME, action: 'copy-pgn', press: ['c', 'C'], keys: ['C'], label: 'Copy the PGN' },
  {
    section: GAME,
    action: 'toggle-move-tab',
    press: ['t', 'T'],
    keys: ['T'],
    label: 'Swap the move column between Moves and Flagged',
  },
]

export interface ShortcutGroup {
  name: string
  /**
   * Where the group applies, tested against the pathname. A group with no `where` is
   * everywhere, and the overlay prints it whatever screen it was raised from.
   */
  where?: RegExp
  shortcuts: Shortcut[]
}

/** The key that raises the overlay, and the one thing about it a component needs to know. */
export const HELP_KEY = '?'

/** A library game or a model game out of the reference books: the same screen either way. */
const READING_A_GAME = /^\/(games\/[^/]+|reference\/)/

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    name: 'Anywhere',
    shortcuts: [
      { keys: ['⌘K'], label: 'Search games, opponents, openings and notes' },
      { keys: ['?'], label: 'This list' },
      { keys: ['⌘1'], label: 'Dashboard' },
      { keys: ['⌘2'], label: 'Games' },
      { keys: ['⌘3'], label: 'Explorer' },
      { keys: ['⌘4'], label: 'Notes' },
      { keys: ['⌘5'], label: 'Stats' },
      { keys: ['⌘⇧I'], label: 'Import' },
      { keys: ['Esc'], label: 'Close whatever is open' },
    ],
  },
  ...BOARD_SECTIONS.map(
    (section): ShortcutGroup => ({
      name: section,
      where: READING_A_GAME,
      shortcuts: BOARD_SHORTCUTS.filter((shortcut) => shortcut.section === section),
    }),
  ),
  {
    name: 'The library table',
    where: /^\/games\/?$/,
    shortcuts: [
      { keys: ['↑', '↓'], label: 'Move along the rows' },
      { keys: ['Home', 'End'], label: 'The first and the last row' },
      { keys: ['↵'], label: 'Open the game under the cursor' },
      { keys: ['/'], label: 'Search the library' },
    ],
  },
  {
    name: 'Walking a line',
    where: /^\/(explorer|repertoire)/,
    shortcuts: [
      { keys: ['←'], label: 'Back one move' },
      { keys: ['→'], label: 'Forward, back down the line you just left' },
    ],
  },
]

/** The groups worth printing on this screen: the global ones, plus whatever matches. */
export function shortcutsFor(pathname: string): ShortcutGroup[] {
  return SHORTCUT_GROUPS.filter((group) => !group.where || group.where.test(pathname))
}

/**
 * One keystroke, spelled the way `press` spells it.
 *
 * Shift is written out even where the browser has already folded it into the key (`J`), so
 * that a table entry and a real event are compared as the same kind of thing.
 */
export function chordOf(event: KeyboardEvent): string {
  return event.shiftKey ? `shift+${event.key}` : event.key
}

/**
 * The board's keystroke → action lookup, built from the table above.
 *
 * A map rather than a switch so that adding a row to `BOARD_SHORTCUTS` is the whole change:
 * the binding, the overlay's line and the dispatch all come from it.
 */
export const BOARD_KEYS: ReadonlyMap<string, BoardAction> = new Map(
  BOARD_SHORTCUTS.flatMap((shortcut) =>
    shortcut.press.map((key) => [key, shortcut.action] as const),
  ),
)
