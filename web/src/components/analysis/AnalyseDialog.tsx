/**
 * **Analyse…** — one run over this game, shaped by the person asking for it.
 *
 * Every import gets the analysis pass at the Settings page's node budget, and that is the
 * floor, not the answer: the moves a person wants to understand deserve a look they chose.
 * So the dialog asks the four things a run is made of and nothing else — which engine, how
 * many lines, what each move's search stops at, and which moves. What comes out is queued
 * ahead of every import pass, and wins over one wherever the two cover the same move.
 *
 * - **Engine** is any engine that is switched on, a runner's included (`EnginePicker` in
 *   `run` mode): a run is ordinary queue work. The analysis role's opens preselected. One
 *   the server already knows it would refuse — its binary gone, Maia on another host — is
 *   greyed with the reason written under the chips, so nobody learns it only on pressing.
 * - **Lines** is left blank by default, the deployment's `analysis_multipv` as placeholder
 *   (`LinesField`).
 * - **Stop each move at** opens on depth 24, a number that means the same on every machine,
 *   which is what makes two runs comparable. Switching kind resets the number to that
 *   kind's default — depth 24, 5 seconds, the import pass's node budget — so nobody is left
 *   with "24 seconds a move" by accident. There is no "Nothing": a game is many positions,
 *   and a search that never stops never reaches the second.
 * - **Moves** opens on the whole game. *This move* is the move that led to the position on
 *   the board — the one whose classification is showing — and *From here on* is that move
 *   to the end. Neither exists at the starting position, where no move has been played.
 *
 * A refusal (an engine away, a limit the server will not take) is shown here, in the
 * dialog, rather than toasted behind it: the choice that caused it is still on screen and
 * can be changed.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Frame } from '@/components/engine-dialog/DialogFrame'
import { EnginePicker, preferredEngine } from '@/components/engine-dialog/EnginePicker'
import { LimitField } from '@/components/engine-dialog/LimitField'
import { LinesField } from '@/components/engine-dialog/LinesField'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { AnalysisRequest, CorrespondenceSearchEngine } from '@/lib/api/types'
import { formatNodes, moveNumberLabel } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

/** What the dialog hands back: an `AnalysisRequest` without the game, which the caller owns. */
export type AnalyseChoice = Pick<
  AnalysisRequest,
  'engine_id' | 'multipv' | 'nodes' | 'depth' | 'seconds' | 'ply_start' | 'ply_end'
>

export type AnalyseLimitKind = 'depth' | 'seconds' | 'nodes'
export type AnalyseMoves = 'this' | 'from-here' | 'whole'

export const DEFAULT_ANALYSE_DEPTH = 24
export const DEFAULT_ANALYSE_SECONDS = 5

export interface AnalyseDialogProps {
  /** `GET /analysis/engines`; `undefined` while it loads. */
  engines: CorrespondenceSearchEngine[] | undefined
  /** The deployment's `analysis_multipv`, which an empty Lines box stands for. */
  defaultMultipv: number
  /** The deployment's `analysis_nodes`, what the Nodes kind resets to. */
  defaultNodes: number
  /**
   * The ply of the move that led to the board's position (`-1` at the start), which is the
   * game view's cursor. *This move* and *From here on* start at it.
   */
  cursor: number
  /** The move at `cursor` as the move list prints it, for the choice's caption. */
  cursorSan: string | null
  plyCount: number
  pending: boolean
  error: string | null
  onQueue: (choice: AnalyseChoice) => void
  onClose: () => void
}

export function AnalyseDialog({
  engines,
  defaultMultipv,
  defaultNodes,
  cursor,
  cursorSan,
  plyCount,
  pending,
  error,
  onQueue,
  onClose,
}: AnalyseDialogProps) {
  const { t } = useLingui()
  const notate = useNotation()
  // `null` until somebody picks: the list may still be loading when the dialog opens, and
  // the preselection has to follow it in rather than be frozen at "nothing".
  const [picked, setPicked] = useState<number | null>(null)
  const engineId = picked ?? (engines ? preferredEngine(engines, 'run') : null)
  const troubled = engines?.filter((engine) => engine.search_trouble) ?? []
  const [multipv, setMultipv] = useState('')
  const [kind, setKind] = useState<AnalyseLimitKind>('depth')
  const [limitValue, setLimitValue] = useState(String(DEFAULT_ANALYSE_DEPTH))
  const [moves, setMoves] = useState<AnalyseMoves>('whole')

  const defaults: Record<AnalyseLimitKind, string> = {
    depth: String(DEFAULT_ANALYSE_DEPTH),
    seconds: String(DEFAULT_ANALYSE_SECONDS),
    nodes: String(defaultNodes),
  }
  function chooseKind(next: AnalyseLimitKind) {
    setKind(next)
    setLimitValue(defaults[next])
  }

  const atStart = cursor < 0 || plyCount === 0
  // A window chosen at a move and then left behind by a cursor that went back to the start
  // cannot be sent; it reads as the whole game rather than refusing the press.
  const effectiveMoves: AnalyseMoves = atStart ? 'whole' : moves
  const limit = parseLimit(kind, limitValue)
  const lines = parseLines(multipv)
  const ready = engineId !== null && limit !== null && lines !== undefined

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || pending || engineId === null || limit === null) return
    const span =
      effectiveMoves === 'this'
        ? { ply_start: cursor, ply_end: cursor + 1 }
        : effectiveMoves === 'from-here'
          ? { ply_start: cursor, ply_end: plyCount }
          : {}
    onQueue({
      engine_id: engineId,
      ...(lines === null ? {} : { multipv: lines }),
      ...(kind === 'depth' ? { depth: limit } : kind === 'seconds' ? { seconds: limit } : { nodes: limit }),
      ...span,
    })
  }

  const budget = formatNodes(defaultNodes)
  const moveName =
    !atStart && cursorSan ? `${moveNumberLabel(cursor)} ${notate(cursorSan)}` : null

  return (
    <Frame
      labelledBy="analyse-dialog-title"
      title={<Trans>Analyse…</Trans>}
      description={t`One run over this game, ahead of every import in the queue. Where it covers a move, its verdict replaces the analysis pass's.`}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>
            <Trans>Engine</Trans>
          </Label>
          {engines === undefined ? (
            <p className="flex items-center gap-2 text-[0.71875rem] text-dim">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              <Trans>Looking for engines…</Trans>
            </p>
          ) : (
            <EnginePicker engines={engines} mode="run" value={engineId} onChange={setPicked} />
          )}
          {/* Said out loud rather than only under the pointer: a greyed chip with no
              reason on a phone is an engine that silently does not work. */}
          {troubled.map((engine) => (
            <p key={engine.engine_id} className="text-[0.71875rem] text-mistake">
              {engine.name}: {engine.search_trouble}
            </p>
          ))}
        </div>

        <div className="flex flex-wrap gap-4">
          <LinesField
            id="analyse-dialog-multipv"
            value={multipv}
            placeholder={defaultMultipv}
            onChange={setMultipv}
          />
          <LimitField
            label={<Trans>Stop each move at</Trans>}
            groupLabel={t`Stop each move at`}
            kinds={[
              { kind: 'depth', label: <Trans>Depth</Trans> },
              { kind: 'seconds', label: <Trans>Seconds</Trans>, step: 'any' },
              { kind: 'nodes', label: <Trans>Nodes</Trans> },
            ]}
            kind={kind}
            value={limitValue}
            onKindChange={chooseKind}
            onValueChange={setLimitValue}
            hint={
              kind === 'depth' ? (
                <Trans>The same depth on every move, so two runs compare, whatever the machine.</Trans>
              ) : kind === 'seconds' ? (
                <Trans>The same time on every move: sharp positions get no more than quiet ones.</Trans>
              ) : (
                <Trans>The analysis pass stops at {budget} nodes.</Trans>
              )
            }
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>
            <Trans>Moves</Trans>
          </Label>
          <div role="group" aria-label={t`Moves`} className="flex flex-wrap gap-1">
            {(['this', 'from-here', 'whole'] as const).map((choice) => {
              const disabled = choice !== 'whole' && atStart
              return (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={effectiveMoves === choice}
                  disabled={disabled}
                  title={disabled ? t`No move has been played at the starting position` : undefined}
                  onClick={() => setMoves(choice)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[0.6875rem] transition-colors',
                    effectiveMoves === choice
                      ? 'border-accent-teal/40 bg-selected text-ink'
                      : 'border-edge text-dim hover:border-edge-hover hover:text-ink',
                    disabled && 'cursor-not-allowed opacity-45 hover:border-edge hover:text-dim',
                  )}
                >
                  {choice === 'this' ? (
                    <Trans>This move</Trans>
                  ) : choice === 'from-here' ? (
                    <Trans>From here on</Trans>
                  ) : (
                    <Trans>Whole game</Trans>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-[0.625rem] leading-[1.5] text-dim-2">
            {effectiveMoves === 'whole' ? (
              <Trans>Every move of the game.</Trans>
            ) : effectiveMoves === 'this' ? (
              <Trans>Only {moveName}, the move that led to the board.</Trans>
            ) : (
              <Trans>From {moveName} to the end of the game.</Trans>
            )}
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-[0.6875rem] text-blunder">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={!ready || pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            <Trans>Analyse</Trans>
          </Button>
        </div>
      </form>
    </Frame>
  )
}

/**
 * The limit as the request carries it, or `null` when the box cannot be sent. Seconds may
 * be a fraction; depth and nodes are whole. Unlike a correspondence search an empty box is
 * not "no limit" — every move needs one — so it holds the button back instead.
 */
export function parseLimit(kind: AnalyseLimitKind, value: string): number | null {
  const text = value.trim()
  const parsed = Number(text)
  if (text === '' || !Number.isFinite(parsed) || parsed <= 0) return null
  if (kind === 'seconds') return parsed
  return parsed >= 1 ? Math.trunc(parsed) : null
}

/** `null` is blank — the deployment decides; `undefined` is a number outside 1 to 5. */
function parseLines(value: string): number | null | undefined {
  const text = value.trim()
  if (text === '') return null
  const parsed = Number(text)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : undefined
}
