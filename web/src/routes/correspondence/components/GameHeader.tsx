/**
 * The bar across the top of a correspondence game: who is playing, whose move it is, when
 * the reply is due, and the three actions that move the game on.
 *
 * The deadline is edited in place because it is the one field that changes every few days
 * and is never worth a dialog. The two actions that append a move are deliberately
 * separate: **Opponent played…** takes a move that arrived by mail, and **Play** commits
 * the candidate the tree is standing on — the same call, but not the same decision, and a
 * single button would make it far too easy to answer your own move. Play is the header's
 * one primary and stands last; the rest are secondary faces.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight, Flag, Inbox, Loader2, Send, Undo2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { TextLink } from '@/components/ui/text-link'
import type {
  CorrespondenceGameSummary,
  CorrespondenceTreeNode,
  Result,
} from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { StepButton } from '@/routes/game/components/GameHeaderBar'

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
  const { t } = useLingui()
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
      className="bb-fade-in fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[14vh] max-md:px-4 max-md:pt-8"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="correspondence-move-title"
        noValidate
        onSubmit={submit}
        className="bb-card bb-rise-in flex w-full max-w-[24rem] flex-col gap-3.5 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="correspondence-move-title" className="text-heading font-semibold text-ink">
            <Trans>The move that arrived</Trans>
          </h2>
          <p className="text-data leading-[1.65] text-dim">
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
            <span className="text-meta text-blunder">
              <Trans>Not a legal move in this position.</Trans>
            </span>
          ) : null}
        </div>
        {tip.children.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-dim">
              <Trans>Already in the tree</Trans>
            </span>
            {/* Each is a command (play this move), so a secondary face; mono, as moves are. */}
            <div className="flex flex-wrap gap-1.5">
              {tip.children.map((child) => (
                <Button
                  key={child.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => child.uci && onPlay(child.uci)}
                  className="font-mono"
                >
                  {notate(child.san ?? child.uci ?? '')}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-data text-blunder"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="submit"
            disabled={uci === null || pending}
            title={uci === null ? t`Type a legal move first` : undefined}
          >
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
      className="bb-fade-in fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[14vh] max-md:px-4 max-md:pt-8"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="correspondence-finish-title"
        noValidate
        onSubmit={submit}
        className="bb-card bb-rise-in flex w-full max-w-[24rem] flex-col gap-3.5 px-5 py-5 shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex flex-col gap-1.5">
          <h2 id="correspondence-finish-title" className="text-heading font-semibold text-ink">
            <Trans>Finish this game</Trans>
          </h2>
          <p className="text-data leading-[1.65] text-dim">
            <Trans>
              It becomes a library game: its analysis pass is queued, it counts in the
              statistics, and the tree stays attached to it — read-only from here on.
            </Trans>
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>
            <Trans>Result</Trans>
          </Label>
          {/* One of three, none chosen until the owner says: the one-of-N control. */}
          <Segmented<Result | ''>
            label={t`Result`}
            value={result ?? ''}
            onChange={(chosen) => {
              if (chosen) setResult(chosen)
            }}
            options={RESULTS.map((option) => ({ value: option, label: option }))}
            className="self-start"
          />
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
            className="rounded-md border border-blunder/28 bg-blunder/5 px-2.5 py-2 text-data text-blunder"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="submit"
            disabled={result === null || pending}
            title={result === null ? t`Pick the result first` : undefined}
          >
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
  walk,
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
  /**
   * The games either side of this one in the list (`neighbours`), `[` and `]`. Null on a
   * finished game, which the list does not open here.
   */
  walk?: { onPrevious: (() => void) | null; onNext: (() => void) | null } | null
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
      {/* The game screen's pair, first on the line as it is there: a few games come round at
          once, and going back to the list between each was the whole of the walk. */}
      {walk ? (
        <ButtonGroup label={t`Correspondence games`} className="flex-none">
          <StepButton
            label={t`Previous correspondence game`}
            hint="["
            spent={t`No correspondence game before this one`}
            onClick={walk.onPrevious}
            icon={ChevronLeft}
          />
          <StepButton
            label={t`Next correspondence game`}
            hint="]"
            spent={t`No correspondence game after this one`}
            onClick={walk.onNext}
            icon={ChevronRight}
          />
        </ButtonGroup>
      ) : null}
      {/* The players are the content's name, not a second page title: the bar's last crumb
          is the page's one heading. */}
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-baseline gap-1.5 text-lead font-medium text-ink">
          <span className="truncate">{game.white}</span>
          {game.owner_color === 'white' ? <Badge className="self-center">{you}</Badge> : null}
          <span className="font-normal text-dim">–</span>
          <span className="truncate">{game.black}</span>
          {game.owner_color === 'black' ? <Badge className="self-center">{you}</Badge> : null}
        </p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-label text-dim">
          {game.event ? <span>{game.event}</span> : null}
          {number ? <span>· {t`ICCF game ${number}`}</span> : null}
          {game.time_control ? <span>· {game.time_control}</span> : null}
          {game.url ? (
            <TextLink href={game.url} external>
              <Trans>the game's page</Trans>
            </TextLink>
          ) : null}
        </p>
      </div>

      {/* Whose move, the move number and the deadline are facts, so they are flat text; the
          one thing here that takes input is the date, and it is a field. */}
      {game.finished ? (
        <span className="font-mono text-data text-body">
          {game.result}
          {game.termination ? (
            <span className="ml-1.5 font-sans text-label text-dim">{game.termination}</span>
          ) : null}
        </span>
      ) : (
        <div className="flex items-center gap-2 text-label whitespace-nowrap">
          <strong className="font-semibold text-ink">
            {game.your_move ? <Trans>Your move</Trans> : <Trans>Their move</Trans>}
          </strong>
          <span className="text-dim">· {t`move ${game.move_number}`}</span>
          {phrase ? (
            <span className={DUE_CLASS[tone]}>· {i18n._({ ...phrase.message, values: phrase.values })}</span>
          ) : null}
          <Input
            type="date"
            inputSize="sm"
            aria-label={t`Reply due`}
            title={t`Reply due`}
            value={dateInputValue(game.reply_due)}
            className="w-[8.5rem] font-mono text-label"
            onChange={(event) => onDue(dateInputToIso(event.target.value))}
          />
        </div>
      )}

      {/* Secondary faces, then the one primary last: playing your move is what the header
          is for. Each disabled button says why in its title. */}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {game.finished ? null : (
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={onFinish}>
              <Flag aria-hidden />
              <Trans>Finish…</Trans>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              disabled={busy || game.ply_count === 0}
              aria-label={t`Take the last move back`}
              title={game.ply_count === 0 ? t`No move to take back yet` : t`Take the last move back`}
              onClick={onUndo}
            >
              <Undo2 aria-hidden />
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={onOpponentMove}>
              <Inbox aria-hidden />
              <Trans>Opponent played…</Trans>
            </Button>
            <Button
              type="button"
              disabled={busy || !playable || !game.your_move}
              title={
                !game.your_move
                  ? t`It is not your move`
                  : playable
                    ? t`Append the selected candidate to the game`
                    : t`Select a candidate move in the tree first`
              }
              onClick={() => playable?.uci && onPlay(playable.uci)}
            >
              <Send aria-hidden />
              {move ? t`Play ${move}` : t`Play this move`}
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
