/**
 * One engine on one node: what it is finding now, or what it concluded and stopped.
 *
 * The `InfiniteAnalysisPanel` shape, with the differences a correspondence search forces.
 * A live board's panel is a session that ends when you click away; this is a process that
 * may have been on this position since Tuesday, so the pane carries its own **Pause**,
 * **Resume** and **Stop**, says how long it has been going, and — because a Leela search's
 * depth means little and its node count means a lot (`docs/correspondence.md`, decision 5)
 * — prints depth *and* nodes side by side rather than choosing one.
 *
 * **Live or stored, never both.** While a search is running the lines are its last snapshot;
 * parked, ended or never started, they are the row the checkpoints wrote. Those are two
 * different claims — "what it is finding" against "what it had concluded" — and mixing them
 * would show a depth-51 header over depth-38 lines the moment a page was reloaded
 * mid-search. The pane says which one it is drawing.
 *
 * Every score is turned into the node's frame first (`format.ts`'s `inNodeFrame`): a
 * snapshot and a stored row both arrive from the side to move's point of view, and this pane
 * is read beside a tree that prints the mover's.
 *
 * **A task is drawn as this engine's verdict like any other**, which is the point of it:
 * the tree does not keep two kinds of number. What differs is the header — a task says it
 * is a task, because it may be running on another machine and it cannot be paused — and the
 * controls, where Cancel replaces Pause/Resume/Stop and is offered only while the task is
 * still waiting its turn.
 *
 * The footer is the eval history — the trajectory that tells a correspondence player
 * whether a number is settled — as a sparkline with one line of words under it. A number
 * that is still climbing at depth 50 is a number that is not finished, and no single
 * evaluation can say that.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Pause, Play, Square as StopIcon, X } from 'lucide-react'
import type { ReactNode } from 'react'

import type {
  CorrespondenceSearch,
  CorrespondenceTreeNode,
} from '@/lib/api/types'
import { formatNps, formatVariation } from '@/lib/analysis'
import { cachedReplay } from '@/lib/board/linePreview'
import type { HoveredLine } from '@/lib/board/useLinePreview'
import { formatNodes, formatScore } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import { inNodeFrame } from '../format'
import {
  formatSpan,
  isLive,
  isTask,
  isWarm,
  limitParts,
  readHistory,
  runningSeconds,
  sparkline,
  type EnginePaneModel,
} from '../searches'

export interface EnginePaneProps {
  pane: EnginePaneModel
  node: CorrespondenceTreeNode
  /** Now, in milliseconds — passed in so the pane has no clock of its own to leak. */
  now: number
  /** Which line the preview stands on, so the pointed-at row can be marked. */
  previewLine?: string | null
  onHover: (line: HoveredLine | null) => void
  onPause: (id: number) => void
  onResume: (id: number) => void
  onStop: (id: number) => void
  /** Take a waiting task out of the queue. A task has no pause and no resume. */
  onCancel?: (id: number) => void
  /** Pin this engine's verdict here, or take the pin off. Absent on a finished game. */
  onPin?: (engineId: number | null) => void
  busy?: boolean
}

/** The status dot and the word beside it: green live, amber parked, quiet otherwise. */
function statusOf(search: CorrespondenceSearch | null) {
  if (!search) return { tone: 'idle' as const }
  if (isLive(search)) return { tone: 'live' as const }
  if (isWarm(search)) return { tone: 'warm' as const }
  if (search.status === 'paused') return { tone: 'cold' as const }
  if (search.status === 'queued') return { tone: 'queued' as const }
  return { tone: 'idle' as const }
}

export function EnginePane({
  pane,
  node,
  now,
  previewLine,
  onHover,
  onPause,
  onResume,
  onStop,
  onCancel,
  onPin,
  busy,
}: EnginePaneProps) {
  const { t } = useLingui()
  const notate = useNotation()
  const { search, stored } = pane
  // A task is the other engine mode and wears none of this pane's controls: it holds no
  // slot to give back, so there is nothing to pause and nothing to resume — only cancel,
  // and only while it is still waiting its turn.
  const task = search !== null && isTask(search)
  const live = search !== null && isLive(search)
  // A task that failed or was cleared away, on a position this engine never got a verdict
  // on — the pane the expansion left behind. Its whole content is the reason below.
  const stopped = search === null && stored === null && pane.ended !== null
  const snapshot = live ? (search?.snapshot ?? null) : null
  const { tone } = statusOf(search)

  // The lines, from whichever of the two claims is the live one. A running search that has
  // not sent a picture yet falls back to what it had checkpointed, which is the honest
  // answer — that IS what the engine last concluded here.
  const lines = (
    snapshot?.lines?.length ? snapshot.lines : (stored?.best_lines ?? [])
  )
    .slice()
    .sort((left, right) => left.multipv - right.multipv)

  const depth = snapshot?.depth ?? stored?.depth ?? null
  const nodes = snapshot?.nodes ?? stored?.nodes ?? null
  const top = lines[0] ?? null
  const score = inNodeFrame(top ?? stored ?? null, node)
  const history = stored?.history ?? []
  const points = sparkline(history)
  const reading = readHistory(history)
  const elapsed = search ? runningSeconds(search, now) : null
  const limits = search ? limitParts(search) : null

  return (
    <section
      data-testid={`engine-pane-${pane.engineId ?? pane.key}`}
      data-live={live ? 'true' : undefined}
      className="flex min-h-0 flex-col border-b border-edge-strong last:border-b-0"
    >
      <div className="flex h-[2.1875rem] flex-none items-center gap-2 border-b border-line bg-panel px-2.5 text-[0.6875rem]">
        <span
          aria-hidden
          className={cn(
            'size-[0.4375rem] flex-none rounded-full',
            tone === 'live'
              ? 'animate-pulse bg-good'
              : tone === 'warm'
                ? 'bg-mistake'
                : tone === 'queued'
                  ? 'bg-accent-teal'
                  : 'bg-edge-strong',
          )}
        />
        <strong className="truncate font-semibold text-ink" title={pane.engineName}>
          {pane.engineName}
        </strong>
        {task ? (
          <span
            className={cn('whitespace-nowrap', live ? 'text-good' : 'text-accent-teal')}
            title={t`A bounded look through the analysis queue, which may be running on another machine`}
          >
            {live ? <Trans>task running</Trans> : <Trans>task waiting in the queue</Trans>}
          </span>
        ) : tone === 'live' ? (
          <span className="whitespace-nowrap text-good">
            {elapsed === null ? (
              <Trans>searching</Trans>
            ) : (
              t`searching · ${formatSpan(elapsed)}`
            )}
          </span>
        ) : tone === 'warm' ? (
          <span className="whitespace-nowrap text-mistake" title={t`The process is parked with its hash intact — resuming costs seconds`}>
            <Trans>parked, warm</Trans>
          </span>
        ) : tone === 'cold' ? (
          <span className="whitespace-nowrap text-dim">
            <Trans>paused, cold</Trans>
          </span>
        ) : tone === 'queued' ? (
          <span className="whitespace-nowrap text-accent-teal">
            <Trans>waiting for a slot</Trans>
          </span>
        ) : stopped ? (
          // Nothing running, nothing stored, and a task that ended badly: the pane exists
          // only to carry the reason under this header, so it must not say "stored".
          <span className="whitespace-nowrap text-blunder">
            <Trans>task stopped</Trans>
          </span>
        ) : (
          <span className="whitespace-nowrap text-dim">
            <Trans>stored</Trans>
          </span>
        )}

        <span className="ml-auto flex flex-none items-center gap-2 font-mono text-[0.625rem] tabular text-dim">
          {/* Per verdict rather than per node: this engine's number can be old news while
              the one in the pane below it is current, and the tree's own mark cannot say
              which of the two it meant. */}
          {stored?.stale && !live ? (
            <span
              data-testid="engine-pane-stale"
              className="text-inaccuracy"
              title={t`This verdict is stale: below the stale depth, or from a version of this engine you no longer have`}
            >
              ⟳
            </span>
          ) : null}
          {depth !== null ? <span>{t`depth ${depth}`}</span> : null}
          {nodes ? <span>{t`${formatNodes(nodes)} nodes`}</span> : null}
          {live && snapshot?.nps ? <span>{formatNps(snapshot.nps)}</span> : null}
          <span className="font-sans text-[0.6875rem] font-semibold text-body">
            {formatScore(score)}
          </span>
        </span>

        {onPin && pane.engineId !== null ? (
          <button
            type="button"
            aria-pressed={pane.pinned}
            title={
              pane.pinned
                ? t`The tree reads this engine here. Click to go back to the deepest.`
                : t`Make this engine's verdict the one the tree reads here`
            }
            onClick={() => onPin(pane.pinned ? null : pane.engineId)}
            className={cn(
              'flex-none rounded-sm border px-1.5 py-px text-[0.625rem] transition-colors',
              pane.pinned
                ? 'border-accent-teal/40 bg-selected text-accent-teal'
                : 'border-transparent text-dim hover:bg-raised hover:text-ink',
            )}
          >
            {pane.pinned ? <Trans>Pinned</Trans> : <Trans>Pin</Trans>}
          </button>
        ) : null}

        {search && task ? (
          <div className="flex flex-none items-center gap-0.5">
            <PaneButton
              label={t`Cancel`}
              // A task an engine has already claimed finishes: there is no cancelled state
              // for a run in flight, and the server says so rather than half-doing it.
              disabled={busy || live || !onCancel}
              onClick={() => onCancel?.(search.id)}
              icon={<X aria-hidden />}
            />
          </div>
        ) : search ? (
          <div className="flex flex-none items-center gap-0.5">
            {search.status === 'paused' || search.status === 'queued' ? (
              <PaneButton
                label={t`Resume`}
                disabled={busy || search.status === 'queued'}
                onClick={() => onResume(search.id)}
                icon={<Play aria-hidden />}
              />
            ) : (
              <PaneButton
                label={t`Pause`}
                disabled={busy}
                onClick={() => onPause(search.id)}
                icon={<Pause aria-hidden />}
              />
            )}
            <PaneButton
              label={t`Stop`}
              disabled={busy}
              onClick={() => onStop(search.id)}
              icon={<StopIcon aria-hidden />}
            />
          </div>
        ) : null}
      </div>

      {/* A task whose queue was cleared under it, or whose run failed for good, left its
          reason on a row that is no longer active — `pane.ended`. It is the only place that
          sentence exists, so it is printed here rather than lost. */}
      {search?.error || pane.ended?.error ? (
        <p role="alert" className="border-b border-hairline bg-blunder/5 px-2.5 py-1 text-[0.625rem] text-blunder">
          {search?.error ?? pane.ended?.error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto" onMouseLeave={() => onHover(null)}>
        {lines.length === 0 ? (
          <p className="px-2.5 py-2 text-[0.6875rem] text-dim">
            {live ? (
              <Trans>The engine has not sent a line yet.</Trans>
            ) : stopped ? (
              <Trans>This engine never got a verdict on this position.</Trans>
            ) : (
              <Trans>No lines were kept for this verdict.</Trans>
            )}
          </p>
        ) : (
          lines.map((line) => {
            const id = `engine:${pane.key}:${line.multipv}`
            const replay = cachedReplay(node.fen, line.pv)
            const sans = replay.moves.map((move) => move.san)
            const text =
              sans.length > 0
                ? notate(formatVariation(node.ply, sans))
                : line.pv.join(' ')
            return (
              <div
                key={line.multipv}
                data-testid="engine-pane-line"
                onMouseEnter={() => onHover({ line: id, ply: null, pv: line.pv })}
                className={cn(
                  'grid grid-cols-[3rem_minmax(0,1fr)] gap-2 border-b border-hairline px-2.5 py-1.5 hover:bg-raised',
                  previewLine === id && 'bg-raised',
                )}
              >
                <span
                  className={cn(
                    'font-mono text-[0.6875rem] font-semibold tabular',
                    line.multipv === 1 ? 'text-good' : 'text-body',
                  )}
                >
                  {formatScore(inNodeFrame(line, node))}
                </span>
                <span
                  className="truncate font-mono text-[0.625rem] leading-[1.55] text-soft"
                  title={text}
                >
                  {text || '—'}
                </span>
              </div>
            )
          })
        )}
      </div>

      <div className="flex h-5.5 flex-none items-center gap-2 border-t border-line bg-panel px-2.5 text-[0.625rem] text-dim">
        {points ? (
          <svg
            aria-hidden
            viewBox="0 0 100 12"
            preserveAspectRatio="none"
            className="h-3 w-[5.625rem] flex-none"
          >
            <polyline points={points} fill="none" stroke="var(--bb-accent)" strokeWidth="1" />
          </svg>
        ) : null}
        <span className="truncate">
          {reading ? (
            <HistoryWords
              from={formatScore(inNodeFrame(reading.from, node))}
              to={formatScore(inNodeFrame(reading.to, node))}
              atFrom={reading.from.depth ?? null}
              atTo={reading.to.depth ?? null}
              stable={reading.stableFor}
              settled={reading.settled}
            />
          ) : limits ? (
            <LimitWords
              depth={limits.depth}
              nodes={limits.nodes}
              seconds={limits.seconds}
            />
          ) : search ? (
            <Trans>No limit — this runs until you stop it.</Trans>
          ) : (
            <Trans>No history yet: an entry lands as the depth or the node count moves.</Trans>
          )}
        </span>
      </div>
    </section>
  )
}

/** The trajectory in words: where it started, where it is, and whether it has stopped moving. */
function HistoryWords({
  from,
  to,
  atFrom,
  atTo,
  stable,
  settled,
}: {
  from: string
  to: string
  atFrom: number | null
  atTo: number | null
  stable: number
  settled: boolean
}) {
  const { t } = useLingui()
  const span =
    atFrom !== null && atTo !== null
      ? t`${from} at depth ${atFrom} → ${to} at depth ${atTo}`
      : t`${from} → ${to}`
  const tail = settled
    ? t`settled`
    : stable > 1
      ? t`best move steady for ${stable} depths`
      : t`still moving`
  return <>{`${span} · ${tail}`}</>
}

/** What will end this search, for a search that has no history to talk about yet. */
function LimitWords({
  depth,
  nodes,
  seconds,
}: {
  depth: number | null
  nodes: number | null
  seconds: number | null
}) {
  const { t } = useLingui()
  const parts: string[] = []
  if (depth !== null) parts.push(t`to depth ${depth}`)
  if (nodes !== null) parts.push(t`to ${formatNodes(nodes)} nodes`)
  if (seconds !== null) parts.push(t`for ${formatSpan(seconds)}`)
  return <>{parts.join(' · ')}</>
}

function PaneButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-5.5 items-center justify-center rounded-sm text-dim transition-colors hover:bg-raised hover:text-ink disabled:cursor-default disabled:opacity-40 [&_svg]:size-3"
    >
      {icon}
    </button>
  )
}
