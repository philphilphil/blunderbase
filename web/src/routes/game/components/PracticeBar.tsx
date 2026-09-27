/**
 * The strip that says a practice game is on: who is playing whom, whose move it is, and
 * the three things a reader does to a practice game — take a move back, see the answers,
 * stop.
 *
 * On the desktop it takes the engine band's row. That row is where the evaluation and the
 * lines are, which is exactly what practice hides, so the strip stands where the reader's
 * eye would go for them and says why they are not there. On the phone it rides above the
 * board. It is never a toast or an overlay on the squares: the board is the game, and
 * nothing is drawn over it.
 *
 * The status is one sentence and it changes in place. A reply that could not be had is a
 * sentence here too, with a retry, since the reader can do nothing else until it comes.
 *
 * The buttons are the app's tool button (`secondary` at `sm`), and Show / Hide the engine
 * is a toggle lit by `aria-pressed` the way every pressed toggle is, rather than a tint of
 * its own.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Eye, EyeOff, Loader2, RotateCcw, Square } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { PracticeGame, PracticePhase, PracticeResult } from '../practice'

const BUTTON = buttonVariants({ variant: 'secondary', size: 'sm' })

export interface PracticeBarProps {
  game: PracticeGame
  phase: PracticePhase | null
  result: PracticeResult | null
  thinking: boolean
  error: string | null
  canTakeBack: boolean
  onTakeBack: () => void
  onToggleReveal: () => void
  onRetry: () => void
  onStop: () => void
  className?: string
}

export function PracticeBar({
  game,
  phase,
  result,
  thinking,
  error,
  canTakeBack,
  onTakeBack,
  onToggleReveal,
  onRetry,
  onStop,
  className,
}: PracticeBarProps) {
  const { t } = useLingui()
  const opponent =
    game.opponent.kind === 'maia'
      ? game.opponent.level === null
        ? 'Maia'
        : `Maia ${game.opponent.level}`
      : game.opponent.elo === null
        ? game.opponent.name
        : `${game.opponent.name} ${game.opponent.elo}`

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="practice-bar"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-surface px-3.5 py-2.5',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-meta tracking-[0.06em] text-dim uppercase">
          {game.side === 'white' ? (
            <Trans>Practice · you play White against {opponent}</Trans>
          ) : (
            <Trans>Practice · you play Black against {opponent}</Trans>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-data text-ink">
          {error ? (
            <span className="text-blunder">{error}</span>
          ) : result ? (
            <ResultText result={result} side={game.side} />
          ) : phase === 'thinking' || thinking ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              <Trans>{opponent} is thinking…</Trans>
            </>
          ) : phase === 'reviewing' ? (
            <Trans>Looking back — step to the end of the line to play on.</Trans>
          ) : (
            <Trans>Your move.</Trans>
          )}
        </span>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-1.5">
        {error ? (
          <button type="button" onClick={onRetry} className={BUTTON}>
            <Trans>Try again</Trans>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onTakeBack}
          disabled={!canTakeBack}
          title={t`Take back your last move and the reply to it`}
          // Disabled, it still shows its tooltip: the base would swallow the hover.
          className={cn(
            BUTTON,
            'disabled:pointer-events-auto disabled:cursor-default disabled:hover:bg-elevated disabled:hover:text-body',
          )}
        >
          <RotateCcw aria-hidden />
          <Trans>Take back</Trans>
        </button>
        <button
          type="button"
          onClick={onToggleReveal}
          aria-pressed={game.reveal}
          title={t`Show or hide the evaluation, the engine lines and Maia (H)`}
          className={BUTTON}
        >
          {game.reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {game.reveal ? <Trans>Hide the engine</Trans> : <Trans>Show the engine</Trans>}
        </button>
        <button
          type="button"
          onClick={onStop}
          title={t`Stop practising; the moves stay on the board as a line (P)`}
          className={BUTTON}
        >
          <Square aria-hidden />
          <Trans>Stop</Trans>
        </button>
      </div>
    </div>
  )
}

function ResultText({ result, side }: { result: PracticeResult; side: PracticeGame['side'] }) {
  switch (result.kind) {
    case 'checkmate':
      return result.winner === side ? (
        <Trans>Checkmate — you won.</Trans>
      ) : (
        <Trans>Checkmate — you lost.</Trans>
      )
    case 'stalemate':
      return <Trans>Stalemate — a draw.</Trans>
    case 'insufficient':
      return <Trans>Neither side can mate — a draw.</Trans>
    case 'fifty-moves':
      return <Trans>Fifty moves without a capture or a pawn move — a draw.</Trans>
    case 'repetition':
      return <Trans>The same position three times — a draw.</Trans>
  }
}
