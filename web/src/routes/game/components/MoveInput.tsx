/**
 * The box a move is typed into — `M` on the game, or the keyboard button beside Hints.
 *
 * A reader entering a line they have in their head is faster on the keys than with the
 * mouse, and every chess site's analysis board knows it. chessground does not (lichess
 * bolts its keyboard box on beside the board too), so this is that box: a small input in
 * the transport row that resolves what is typed against the position on the board
 * (`moveInput.ts`) and plays it.
 *
 * It plays a move the moment the text can only mean that move — `Nf3` is on the board
 * before Enter is reached — and waits on Enter for anything that could still grow (`O-O`
 * while `O-O-O` is also legal). After a move the box empties and keeps focus, so a whole
 * variation is typed as one run of moves; Escape closes it. What was typed is answered
 * under the reader's fingers in the row itself: the move it resolved to in the reader's
 * own notation, the pieces it is ambiguous between, or that no such move exists.
 *
 * The arrow keys, Home and End belong to the caret while the box is focused — the board's
 * shortcuts step aside for any field (`useBoardKeys` asks `isTyping`) — which is the
 * ordinary price of a text box and the reason it is opened deliberately rather than always
 * on: closed, the keyboard is the board's again.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import type { Chess } from 'chessops/chess'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { useNotation } from '@/lib/chess/notationPrefs'
import { currentLocale, isLocale, type Locale } from '@/lib/i18n/locale'
import { cn } from '@/lib/utils'

import { resolveTypedMove, type TypedMove } from '../moveInput'

export interface MoveInputProps {
  /** The position the move is typed into — the board's, at its cursor. */
  board: Chess
  onPlay: (move: TypedMove) => void
  onClose: () => void
  /**
   * Bumped by the page when `M` is pressed while the box is already open, so the key
   * brings the caret back to it rather than doing nothing.
   */
  focusNonce?: number
  className?: string
}

export function MoveInput({ board, onPlay, onClose, focusNonce = 0, className }: MoveInputProps) {
  const { t, i18n } = useLingui()
  const notate = useNotation()
  const locale: Locale = isLocale(i18n.locale) ? i18n.locale : currentLocale()
  const [text, setText] = useState('')
  // Set when Enter was pressed on text that is not a move, so the row says so once rather
  // than the hint shouting "no such move" at every half-typed letter.
  const [refused, setRefused] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [focusNonce])

  const resolution = useMemo(() => resolveTypedMove(board, text, locale), [board, text, locale])

  const play = (move: TypedMove) => {
    onPlay(move)
    setText('')
    setRefused(false)
  }

  const change = (next: string) => {
    setText(next)
    setRefused(false)
    // The position is the one in `board`, and `next` is what the box now holds: resolved
    // here rather than through the memo above, which still describes the previous text.
    const now = resolveTypedMove(board, next, locale)
    if (now.kind === 'move' && now.complete) play(now.move)
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      // Stop it here: the page's own Escape (leave the line) listens on `window`, and one
      // key closing the box *and* leaving the variation it was typing would be two things.
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (resolution.kind === 'move') play(resolution.move)
    else if (resolution.kind !== 'empty') setRefused(true)
  }

  const hint = (() => {
    switch (resolution.kind) {
      case 'move':
        return { text: `${notate(resolution.move.san)} ↵`, tone: 'text-accent-teal' }
      case 'ambiguous':
        return {
          text: resolution.moves.map((move) => notate(move.san)).join(' · '),
          tone: 'text-inaccuracy',
        }
      case 'none':
        return refused || text.length >= 2
          ? { text: t`No such move`, tone: 'text-blunder' }
          : null
      case 'partial':
        return refused ? { text: t`Not a whole move yet`, tone: 'text-dim' } : null
      case 'empty':
        return null
    }
  })()

  return (
    <div className={cn('flex flex-none items-center gap-1.5', className)}>
      <input
        ref={input}
        type="text"
        value={text}
        onChange={(event) => change(event.target.value)}
        onKeyDown={keyDown}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={t`Type a move`}
        placeholder={t`Nf3, exd5, O-O…`}
        aria-invalid={resolution.kind === 'none' && text.length >= 2 ? true : undefined}
        className={cn(
          'h-[1.625rem] w-[6.5rem] rounded-md border border-edge bg-elevated px-2 font-mono text-xs text-ink outline-none transition-colors',
          'placeholder:text-faint focus-visible:border-accent-teal/50 aria-invalid:border-blunder max-md:h-8',
        )}
      />
      {hint ? (
        <span
          role="status"
          className={cn('font-mono text-[0.6875rem] whitespace-nowrap', hint.tone)}
        >
          {hint.text}
        </span>
      ) : (
        <span className="sr-only">
          <Trans>Type a move in notation; it is played as soon as it is unambiguous.</Trans>
        </span>
      )}
    </div>
  )
}
