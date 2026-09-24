/**
 * Putting a position on the Board: one box that takes a FEN or a PGN, and a way back to
 * the starting position.
 *
 * One box rather than a FEN field and a PGN field because the person pasting knows what is
 * on their clipboard and should not have to say it twice; `detectInput` tells the two
 * apart and the reader that refuses one says what was wrong with it, under the box, in the
 * dialog that is still open — so the paste can be fixed rather than retyped.
 *
 * It stands on the engine dialogs' `Frame`, so Escape and the backdrop close it the way
 * they close every other dialog, and the board's arrow keys stand down while it is open.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { useState, type FormEvent } from 'react'

import { Frame } from '@/components/engine-dialog/DialogFrame'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

import { detectInput, type BoardInput } from './localBoard'

export function LoadPositionDialog({
  pending,
  error,
  onLoad,
  onNew,
  onClose,
}: {
  pending: boolean
  error: string | null
  onLoad: (input: BoardInput) => void
  onNew: () => void
  onClose: () => void
}) {
  const { t } = useLingui()
  const [text, setText] = useState('')
  const input = detectInput(text)

  function submit(submitted: FormEvent) {
    submitted.preventDefault()
    if (input && !pending) onLoad(input)
  }

  return (
    <Frame
      labelledBy="board-load-title"
      title={<Trans>Load a position</Trans>}
      description={
        <Trans>
          Paste a FEN or a PGN. A PGN brings its mainline, which you can step through; its
          variations and comments are left out. Pasting anywhere on the page does the same.
        </Trans>
      }
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="board-load-text">
            {input && 'fen' in input ? <Trans>FEN</Trans> : input ? <Trans>PGN</Trans> : <Trans>FEN or PGN</Trans>}
          </Label>
          <textarea
            id="board-load-text"
            value={text}
            autoFocus
            rows={7}
            spellCheck={false}
            onChange={(changed) => setText(changed.target.value)}
            placeholder={t`rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1 — or a whole game`}
            className="w-full resize-y rounded-md border border-input bg-elevated px-2.5 py-2 font-mono text-[0.6875rem] leading-[1.6] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
          />
        </div>
        {error ? (
          <p role="alert" className="text-[0.71875rem] text-blunder">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onNew}>
            <Trans>Starting position</Trans>
          </Button>
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" size="sm" disabled={!input || pending}>
            <Trans>Load</Trans>
          </Button>
        </div>
      </form>
    </Frame>
  )
}
