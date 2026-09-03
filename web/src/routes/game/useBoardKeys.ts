import { useEffect, useRef } from 'react'

import { BOARD_KEYS, chordOf, isTyping, JUMP, type BoardAction } from '@/lib/ui/shortcuts'

/**
 * What each key does, one handler per action in `BOARD_SHORTCUTS`.
 *
 * All but the first six are optional, and a missing one means the key falls through to the
 * browser rather than being swallowed. That is what lets one hook serve a screen that has
 * a game behind it and one that does not: the explorer's stand-in board has no note to
 * write, no run to queue and no line to leave, and on it those keys simply are not bound.
 */
export interface BoardKeyHandlers {
  step: (delta: number) => void
  seekStart: () => void
  seekEnd: () => void
  nextFlagged: () => void
  previousFlagged: () => void
  flip: () => void
  toggleHints?: () => void
  /** The live search on the position the board is showing. */
  toggleEngine?: () => void
  note?: () => void
  /** Leave the analysis line. No-op — and so not handled — when there is none. */
  exitLine?: () => void
  /** Walk the engine's own move here onto the board. */
  playBest?: () => void
  boardSettings?: () => void
  queueQuick?: () => void
  queueDeep?: () => void
  copyPgn?: () => void
  toggleMoveTab?: () => void
  autoplay?: () => void
  previousGame?: () => void
  nextGame?: () => void
}

/**
 * Escape belongs to whatever is on top.
 *
 * The palette, the board settings and the password sheet all close on Escape and all
 * listen on `document`, which bubbles on to this listener on `window` — so without this
 * a reader dismissing a dialog would also be thrown out of the line they were walking,
 * having pressed one key and had two things happen. An open dialog takes the key.
 */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null
}

const CONTROLS = 'button, a[href], [role="button"], [role="checkbox"], [role="switch"]'

/**
 * Enter and Space press whatever the *keyboard* is on, and that has to keep working.
 *
 * They are the only two keys here the browser already spends on the focused control, so
 * somebody who tabbed to "Flip" and pressed Space must flip the board rather than start the
 * game playing through.
 *
 * The trap is that "has focus" is not the same question. Clicking a button leaves it
 * focused without making it what the keyboard is aimed at, and this page is made of buttons
 * — every move in the list is one. Guarding on focus alone meant clicking a move (the most
 * ordinary gesture on the screen) quietly swallowed the next ↵, and pressing it again just
 * re-pressed that move: the shortcut worked, or did nothing, according to whether the
 * reader had touched the mouse.
 *
 * So the modality is tracked instead: a pointer press means focus is wherever the mouse
 * left it and the keys are the page's, a Tab means the reader is driving from the keyboard
 * and the focused control is theirs. This is what `:focus-visible` is for, and it would be
 * the obvious thing to ask the browser — except that it cannot be tested here, jsdom
 * answering it differently for the same gesture in two different trees. Ten lines that are
 * true in every renderer beat one line that is only true in some of them.
 */
const PRESSES_A_CONTROL = new Set([' ', 'Enter'])

function onAControl(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  return !!element?.closest(CONTROLS)
}

/**
 * The game view's keyboard.
 *
 * Which key does what is `lib/ui/shortcuts.ts`'s business, not this hook's: the same table
 * the help overlay prints is the one dispatched from here, so a shortcut cannot be listed
 * without working or changed without the list following. This hook is only the wiring —
 * where the listener lives, and when a keystroke is none of its business.
 *
 * Bound on `window` so the shortcuts work wherever focus happens to be — except inside a
 * field, and except when a modifier makes it a browser command.
 */
export function useBoardKeys(handlers: BoardKeyHandlers, enabled = true): void {
  const current = useRef(handlers)
  useEffect(() => {
    current.current = handlers
  })

  // Which of the two the reader is driving with right now — see `PRESSES_A_CONTROL`. Both
  // listeners are on the capture phase, so a control that swallows the event still counts.
  const driving = useRef<'pointer' | 'keyboard'>('pointer')
  useEffect(() => {
    const pointer = () => {
      driving.current = 'pointer'
    }
    const tab = (event: KeyboardEvent) => {
      if (event.key === 'Tab') driving.current = 'keyboard'
    }
    window.addEventListener('pointerdown', pointer, true)
    window.addEventListener('keydown', tab, true)
    return () => {
      window.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('keydown', tab, true)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      const action = BOARD_KEYS.get(chordOf(event))
      if (!action) return
      if (action === 'exit-line' && dialogOpen()) return
      if (
        PRESSES_A_CONTROL.has(event.key) &&
        driving.current === 'keyboard' &&
        onAControl(event.target)
      ) {
        return
      }
      if (!run(action, current.current)) return
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/** Whether the key was ours to take — an action nobody handles is left to the browser. */
function run(action: BoardAction, keys: BoardKeyHandlers): boolean {
  switch (action) {
    case 'step-back':
      keys.step(-1)
      return true
    case 'step-forward':
      keys.step(1)
      return true
    case 'seek-start':
      keys.seekStart()
      return true
    case 'seek-end':
      keys.seekEnd()
      return true
    case 'next-flagged':
      keys.nextFlagged()
      return true
    case 'previous-flagged':
      keys.previousFlagged()
      return true
    case 'flip':
      keys.flip()
      return true
    case 'jump-back':
      keys.step(-JUMP)
      return true
    case 'jump-forward':
      keys.step(JUMP)
      return true
    case 'toggle-hints':
      return call(keys.toggleHints)
    case 'toggle-engine':
      return call(keys.toggleEngine)
    case 'note':
      return call(keys.note)
    case 'exit-line':
      return call(keys.exitLine)
    case 'play-best':
      return call(keys.playBest)
    case 'board-settings':
      return call(keys.boardSettings)
    case 'queue-quick':
      return call(keys.queueQuick)
    case 'queue-deep':
      return call(keys.queueDeep)
    case 'copy-pgn':
      return call(keys.copyPgn)
    case 'toggle-move-tab':
      return call(keys.toggleMoveTab)
    case 'autoplay':
      return call(keys.autoplay)
    case 'previous-game':
      return call(keys.previousGame)
    case 'next-game':
      return call(keys.nextGame)
  }
}

function call(handler: (() => void) | undefined): boolean {
  handler?.()
  return !!handler
}
