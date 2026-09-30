import { Trans, useLingui } from '@lingui/react/macro'

import { EvalText } from '@/components/badges/EvalText'
import type { EngineLine, SampleResponse } from '@/lib/api/types'
import { formatNodes } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

/** How much of a principal variation is worth showing next to a test run. */
const PV_MOVES = 8

interface PolicyMove {
  uci?: string
  san?: string
  rank?: number
  p?: number
}

function policyEntries(policy: Record<string, unknown> | null | undefined): [string, PolicyMove[]][] {
  if (!policy) return []
  return Object.entries(policy).map(([level, moves]) => [
    level,
    Array.isArray(moves) ? (moves as PolicyMove[]) : [],
  ])
}

function Pv({ line }: { line: EngineLine }) {
  const notate = useNotation()
  const moves = (line.san ?? line.pv ?? []).slice(0, PV_MOVES)
  return (
    <span className="min-w-0 flex-1 truncate font-mono text-data text-soft-2">
      {notate(moves.join(' ')) || '—'}
    </span>
  )
}

/**
 * What the test-run button got back: one position through this engine, right now.
 *
 * A UCI engine answers with an evaluation and its lines; a Maia model answers with the
 * moves a human of that rating would play, which is a different question and is drawn
 * differently — purple, per the palette.
 *
 * All of it is readout: the kind and the policy moves are borderless tints, and the best
 * move is ink rather than accent, since accent text is kept for links.
 */
export function SampleResult({ sample }: { sample: SampleResponse }) {
  const { t } = useLingui()
  const notate = useNotation()
  const lines = sample.lines ?? []
  const elapsed = sample.elapsed_ms
  const nodes = formatNodes(sample.nodes)
  const depth = sample.depth ? `d${sample.depth}` : '—'
  const policy = policyEntries(sample.policy as Record<string, unknown> | null | undefined)

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="text-data font-medium text-ink">{sample.engine_name}</span>
        <span
          className={cn(
            'rounded-sm px-1.5 py-px text-meta',
            sample.kind === 'maia' ? 'bg-deep/10 text-deep' : 'bg-chip-neutral text-soft',
          )}
        >
          {sample.kind}
        </span>
        <div className="flex-1" />
        <span className="font-mono text-label text-dim tabular">
          <Trans>{elapsed} ms</Trans>
        </span>
      </div>

      {sample.kind === 'maia' ? (
        <div className="flex flex-col gap-2">
          {policy.length === 0 ? (
            <p className="text-data text-dim">
              <Trans>The model returned no policy.</Trans>
            </p>
          ) : null}
          {policy.map(([level, moves]) => (
            <div key={level} className="flex flex-col gap-1">
              <span className="font-mono text-meta text-dim">
                {level === 'any' ? t`policy` : t`rating ${level}`}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {moves.slice(0, 5).map((move, index) => (
                  <span
                    key={`${level}-${move.uci ?? index}`}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-deep/10 px-1.5 py-px font-mono text-label text-deep"
                  >
                    {move.san ? notate(move.san) : (move.uci ?? '—')}
                    {typeof move.p === 'number' ? (
                      <span className="tabular text-meta text-deep/70">
                        {(move.p * 100).toFixed(0)}%
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <EvalText
              score={{ cp: sample.cp, mate: sample.mate }}
              className="text-value font-semibold"
            />
            <span className="font-mono text-label text-dim tabular">
              <Trans>
                {depth} · {nodes} nodes
              </Trans>
            </span>
            <div className="flex-1" />
            {sample.best_move ? (
              <span className="font-mono text-data font-medium text-ink">
                {sample.best_move.san ? notate(sample.best_move.san) : sample.best_move.uci}
              </span>
            ) : null}
          </div>

          {lines.length > 0 ? (
            <ul className="flex flex-col gap-1 border-t border-hairline pt-2">
              {lines.map((line, index) => (
                <li key={line.multipv ?? index} className="flex items-center gap-2.5">
                  <span className="w-4 font-mono text-meta text-faint tabular">
                    {line.multipv ?? index + 1}
                  </span>
                  <EvalText
                    score={{ cp: line.cp, mate: line.mate }}
                    className="w-14 text-label"
                  />
                  <Pv line={line} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <p className="truncate border-t border-hairline pt-2 font-mono text-meta text-faint">
        {sample.fen}
      </p>
    </div>
  )
}
