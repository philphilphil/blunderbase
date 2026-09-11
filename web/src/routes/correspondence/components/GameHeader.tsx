/**
 * The bar across the top of a correspondence game: who is playing, whose move it is, when
 * the reply is due, and the three actions that move the game on.
 *
 * The deadline is edited in place because it is the one field that changes every few days
 * and is never worth a dialog. The two actions that append a move are deliberately
 * separate: **Opponent played…** takes a move that arrived by mail, and **Play** commits
 * the candidate the tree is standing on — the same call, but not the same decision, and a
 * single button would make it far too easy to answer your own move.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { ExternalLink, Flag, Loader2, Undo2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  CorrespondenceGameSummary,
  CorrespondenceTreeNode,
  Result,
} from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import { dateInputToIso, dateInputValue, duePhrase, dueTone, iccfNumber } from '../format'
import { parseMoveText } from '../moves'

const DUE_CLASS: Record<string, string> = {
  late: 'text-blunder',
  soon: 'text-mistake',
  calm: 'text-body',
  none: 'text-dim',
}

/** The result a finished game is filed under. `*` is not one of them. */
const RESULTS: Result[] = ['1-0', '0-1', '1/2-1/2']

export function OpponentMoveDialog({
  tip,
  pending,
  error,
  onPlay,
  onClose,
}: {
  /** The position the game stands in — what the move is read against. */
  tip: CorrespondenceTreeNode
  pending: boolean
  error: string | null
  onPlay: (uci: string) => void
  onClose: () => void
}) {
  const notate = useNotation()
  const [text, setText] = useState('')
  const uci = parseMoveText(tip.fen, text)
  const typedButWrong = text.trim() !== '' && uci === null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (uci && !pending) onPlay(uci)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[14vh] max-md:px-4 max-md:pt-8"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="correspondence-move-title"
        noValidate
        onSubmit={submit}
        className="bb-card flex w-full max-w-[24rem] flex-col gap-3.5 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="correspondence-move-title" className="text-[0.875rem] font-semibold text-ink">
            <Trans>The move that arrived</Trans>
          </h2>
          <p className="text-[0.75rem] leading-[1.65] text-dim">
            <Trans>
              Written the way the move mail writes it, or as UCI. It is appended to the game
              and becomes the line the tree hangs off.
            </Trans>
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correspondence-move">
            <Trans>Move</Trans>
          </Label>
          <Input
            id="correspondence-move"
            value={text}
            autoFocus
            autoComplete="off"
            aria-invalid={typedButWrong}
            className="font-mono"
            placeholder="Nf5"
            onChange={(event) => setText(event.target.value)}
          />
          {typedButWrong ? (
            <span className="text-[0.625rem] text-blunder">
              <Trans>Not a legal move in this position.</Trans>
            </span>
          ) : null}
        </div>
        {tip.children.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.625rem] tracking-[0.06em] text-faint uppercase">
              <Trans>Already in the tree</Trans>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {tip.children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  disabled={pending}
                  onClick={() => child.uci && onPlay(child.uci)}
                  className="rounded-md border border-edge px-2 py-1 font-mono text-[0.6875rem] text-body hover:border-edge-hover hover:text-ink"
                >
                  {notate(child.san ?? child.uci ?? '')}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-[0.75rem] text-blunder"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={uci === null || pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            <Trans context="button">Play it</Trans>
          </Button>
        </div>
      </form>
    </div>
  )
}

export function FinishDialog({
  pending,
  error,
  onFinish,
  onClose,
}: {
  pending: boolean
  error: string | null
  onFinish: (result: Result, termination: string | null) => void
  onClose: () => void
}) {
  const { t } = useLingui()
  const [result, setResult] = useState<Result | null>(null)
  const [termination, setTermination] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (result && !pending) onFinish(result, termination.trim() || null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[14vh] max-md:px-4 max-md:pt-8"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="correspondence-finish-title"
        noValidate
        onSubmit={submit}
        className="bb-card flex w-full max-w-[24rem] flex-col gap-3.5 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="correspondence-finish-title" className="text-[0.875rem] font-semibold text-ink">
            <Trans>Finish this game</Trans>
          </h2>
          <p className="text-[0.75rem] leading-[1.65] text-dim">
            <Trans>
              It becomes a library game: the quick and deep passes are queued, it counts in
              the statistics, and the tree stays attached to it — read-only from here on.
            </Trans>
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>
            <Trans>Result</Trans>
          </Label>
          <div role="group" aria-label={t`Result`} className="flex gap-2">
            {RESULTS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={result === option}
                onClick={() => setResult(option)}
                className={cn(
                  'flex-1 rounded-md border px-2 py-1.5 font-mono text-[0.75rem] transition-colors',
                  result === option
                    ? 'border-accent-teal/40 bg-selected text-ink'
                    : 'border-edge text-dim hover:border-edge-hover hover:text-ink',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="correspondence-termination">
            <Trans>How it ended</Trans>
          </Label>
          <Input
            id="correspondence-termination"
            value={termination}
            autoComplete="off"
            placeholder={t`Resignation, agreed draw, adjudication…`}
            onChange={(event) => setTermination(event.target.value)}
          />
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-[0.75rem] text-blunder"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={result === null || pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            <Trans>Finish game</Trans>
          </Button>
        </div>
      </form>
    </div>
  )
}

export function GameHeader({
  game,
  playable,
  onDue,
  onOpponentMove,
  onPlay,
  onUndo,
  onFinish,
  busy,
}: {
  game: CorrespondenceGameSummary
  /** The candidate the tree is standing on, when it is one this game could play now. */
  playable: CorrespondenceTreeNode | null
  onDue: (iso: string | null) => void
  onOpponentMove: () => void
  onPlay: (uci: string) => void
  onUndo: () => void
  onFinish: () => void
  busy: boolean
}) {
  const { i18n, t } = useLingui()
  const notate = useNotation()
  const number = iccfNumber(game)
  const phrase = duePhrase(game.days_left)
  const tone = dueTone(game)
  const you = game.owner_color === 'black' ? t`you · Black` : t`you · White`
  const move = playable?.san ? notate(playable.san) : null

  return (
    <header className="flex flex-none flex-wrap items-center gap-4 border-b border-edge-strong bg-surface px-4 py-2">
      <div className="min-w-0">
        <h1 className="flex min-w-0 flex-wrap items-baseline gap-1.5 text-[1rem] leading-[1.15] font-semibold text-ink">
          <span className="truncate">{game.white}</span>
          {game.owner_color === 'white' ? <YouBadge label={you} /> : null}
          <span className="font-normal text-dim">–</span>
          <span className="truncate">{game.black}</span>
          {game.owner_color === 'black' ? <YouBadge label={you} /> : null}
        </h1>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-[0.6875rem] text-dim">
          {game.event ? <span>{game.event}</span> : null}
          {number ? <span>· {t`ICCF game ${number}`}</span> : null}
          {game.time_control ? <span>· {game.time_control}</span> : null}
          {game.url ? (
            <a
              href={game.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent-teal hover:text-accent-link"
            >
              <Trans>the game's page</Trans>
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : null}
        </p>
      </div>

      {game.finished ? (
        <span className="rounded-md border border-edge px-2 py-1 font-mono text-[0.6875rem] text-body">
          {game.result}
          {game.termination ? <span className="ml-1.5 text-dim">{game.termination}</span> : null}
        </span>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-edge px-2.5 py-1 text-[0.6875rem] whitespace-nowrap">
          <strong className="font-semibold text-ink">
            {game.your_move ? <Trans>Your move</Trans> : <Trans>Their move</Trans>}
          </strong>
          <span className="text-dim">· {t`move ${game.move_number}`}</span>
          {phrase ? (
            <span className={DUE_CLASS[tone]}>· {i18n._({ ...phrase.message, values: phrase.values })}</span>
          ) : null}
          <Input
            type="date"
            aria-label={t`Reply due`}
            value={dateInputValue(game.reply_due)}
            className="h-6 w-[8.5rem] font-mono text-[0.6875rem]"
            onChange={(event) => onDue(dateInputToIso(event.target.value))}
          />
        </div>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {game.finished ? null : (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={onOpponentMove}>
              <Trans>Opponent played…</Trans>
            </Button>
            <Button
              type="button"
              disabled={busy || !playable || !game.your_move}
              title={
                game.your_move
                  ? t`Append the selected candidate to the game`
                  : t`It is not your move`
              }
              onClick={() => playable?.uci && onPlay(playable.uci)}
            >
              {move ? t`Play ${move}` : t`Play this move`}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy || game.ply_count === 0}
              aria-label={t`Take the last move back`}
              title={t`Take the last move back`}
              onClick={onUndo}
            >
              <Undo2 aria-hidden />
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onFinish}>
              <Flag aria-hidden />
              <Trans>Finish…</Trans>
            </Button>
          </>
        )}
      </div>
    </header>
  )
}

function YouBadge({ label }: { label: string }) {
  return (
    <span className="rounded-sm border border-edge px-1.5 py-px align-[0.0625rem] font-mono text-[0.625rem] font-normal text-dim">
      {label}
    </span>
  )
}
