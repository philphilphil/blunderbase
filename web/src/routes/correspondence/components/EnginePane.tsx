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
 * Every score is turned into White's frame first (`format.ts`'s `rowAsWhite`): a snapshot
 * and a stored row both arrive from the side to move's point of view, and every number on
 * these screens is printed as White's.
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
import { Pause, Pin, Play, Square as StopIcon, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { StatusDot } from '@/components/badges/StatusDot'
import { Button } from '@/components/ui/button'
import { ROW } from '@/components/ui/row'

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

import { rowAsWhite } from '../format'
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
  // A search on a runner whose link is down: the row says running or queued, and nothing
  // is happening until the machine comes back. Said before "searching", which would be a lie.
  if (
    search.host_connected === false &&
    (search.status === 'running' || search.status === 'queued')
  ) {
    return { tone: 'away' as const }
  }
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
  const score = rowAsWhite(top ?? stored ?? null, node)
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
      {/* Two rows, not one: the name and the figures both matter, and on a pane this
          narrow a single row squeezed the name — the one thing that tells two panes on
          the same node apart — to nothing. The controls sit by the name; what the
          engine is doing and how far it has got sits under it. */}
      <div className="flex flex-none flex-col gap-0.5 border-b border-line bg-panel px-2.5 py-1.5 text-label">
        <div className="flex items-center gap-2">
          <StatusDot
            className="size-[0.4375rem]"
            tone={
              tone === 'live'
                ? 'working'
                : tone === 'warm' || tone === 'away'
                  ? 'degraded'
                  : tone === 'queued'
                    ? 'waiting'
                    : 'away'
            }
          />
          <strong className="truncate font-semibold text-ink" title={pane.engineName}>
            {pane.engineName}
          </strong>

          {/* A toggle in a strip: a ghost button whose on state is the pressed fill. */}
          {onPin && pane.engineId !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-pressed={pane.pinned}
              title={
                pane.pinned
                  ? t`The tree reads this engine here. Click to go back to the deepest.`
                  : t`Make this engine's verdict the one the tree reads here`
              }
              onClick={() => onPin(pane.pinned ? null : pane.engineId)}
              className="ml-auto h-5 flex-none px-1.5 text-meta"
            >
              <Pin aria-hidden />
              {pane.pinned ? <Trans>Pinned</Trans> : <Trans>Pin</Trans>}
            </Button>
          ) : null}

          {search && task ? (
            <div className="ml-auto flex flex-none items-center gap-0.5">
              <PaneButton
                label={t`Cancel`}
                // A task an engine has already claimed finishes: there is no cancelled state
                // for a run in flight, and the server says so rather than half-doing it.
                disabled={busy || live || !onCancel}
                why={live ? t`An engine has already taken this task; it runs to its end` : undefined}
                onClick={() => onCancel?.(search.id)}
                icon={<X aria-hidden />}
              />
            </div>
          ) : search ? (
            <div className="ml-auto flex flex-none items-center gap-0.5">
              {search.status === 'paused' || search.status === 'queued' ? (
                <PaneButton
                  label={t`Resume`}
                  disabled={busy || search.status === 'queued'}
                  why={search.status === 'queued' ? t`It is waiting for a slot already` : undefined}
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

        <div className="flex items-center gap-2">
          {task ? (
            <span
              className={cn('whitespace-nowrap', live ? 'text-good' : 'text-dim')}
              title={t`A bounded look through the analysis queue, which may be running on another machine`}
            >
              {live ? <Trans>task running</Trans> : <Trans>task waiting in the queue</Trans>}
            </span>
          ) : tone === 'away' ? (
            <span
              className="whitespace-nowrap text-mistake"
              title={t`The runner this search is on is not connected. It starts again from its last checkpoint when the runner comes back.`}
            >
              <Trans>waiting for host</Trans>
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
            <span className="whitespace-nowrap text-dim">
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

          <span className="ml-auto flex flex-none items-center gap-2 font-mono text-meta tabular text-dim">
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
            <span className="font-sans text-label font-semibold text-body">
              {formatScore(score)}
            </span>
          </span>
        </div>
      </div>

      {/* A task whose queue was cleared under it, or whose run failed for good, left its
          reason on a row that is no longer active — `pane.ended`. It is the only place that
          sentence exists, so it is printed here rather than lost. */}
      {search?.error || pane.ended?.error ? (
        <p role="alert" className="border-b border-hairline bg-blunder/5 px-2.5 py-1 text-meta text-blunder">
          {search?.error ?? pane.ended?.error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto" onMouseLeave={() => onHover(null)}>
        {lines.length === 0 ? (
          <p className="px-2.5 py-2 text-label text-dim">
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
                  ROW,
                  'grid grid-cols-[3rem_minmax(0,1fr)] gap-2 border-b border-hairline px-2.5 py-1.5',
                  previewLine === id && 'bg-raised',
                )}
              >
                <span
                  className={cn(
                    'font-mono text-label font-semibold tabular',
                    line.multipv === 1 ? 'text-good' : 'text-body',
                  )}
                >
                  {formatScore(rowAsWhite(line, node))}
                </span>
                <span
                  className="truncate font-mono text-meta leading-[1.55] text-soft"
                  title={text}
                >
                  {text || '—'}
                </span>
              </div>
            )
          })
        )}
      </div>

      <div className="flex h-5.5 flex-none items-center gap-2 border-t border-line bg-panel px-2.5 text-meta text-dim">
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
              from={formatScore(rowAsWhite(reading.from, node))}
              to={formatScore(rowAsWhite(reading.to, node))}
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

/**
 * An icon tool in the pane's head: the pane strip's ghost square (`PANE_TOOL`), named twice
 * (`aria-label` and `title`). Disabled, its title says why rather than repeating the name.
 */
function PaneButton({
  label,
  icon,
  onClick,
  disabled,
  why,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  /** Why it cannot be pressed now, shown on hover while disabled. */
  why?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={disabled && why ? why : label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  )
}
