/**
 * **Expand…** — the verb that fills an evening of engine time in one press.
 *
 * Three answers, and the third is the one that surprises people: *width* is how many moves
 * each stage keeps, *stages* is how many levels deep it goes, and **Queue tasks** off means
 * put the moves in the tree and calculate nothing. The arithmetic is printed under them
 * because width and stages multiply — three and three is up to thirty-nine positions, which
 * is a night of one engine — and nobody does that sum in their head while deciding.
 *
 * Width is left blank by default rather than filled in: blank is the deployment's **Lines
 * per task**, the same rule every other correspondence number follows, and a box that
 * pre-filled the current default would quietly freeze it the first time the setting moved.
 *
 * The engine is chosen here, once, for every task of the expansion — the later stages
 * included, which the server carries on each task's row. Any enabled UCI engine will do,
 * a runner's included: a task is ordinary queue work, and the machine bought for
 * correspondence is usually the runner.
 *
 * What the marks under the node do to both numbers is the manual's business
 * (`guide/correspondence`, *Tasks and expansion*) and the server's; the dialog says the one
 * sentence that stops it being a surprise and does not restate the table.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  CorrespondenceExpand,
  CorrespondenceSearchEngine,
  CorrespondenceTreeNode,
} from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import { Field, Frame } from './DialogFrame'
import { EnginePicker, preferredEngine } from './EnginePicker'

/** 1 to 3, and the server clamps to the same — see `MAX_EXPAND_STAGES`. */
const STAGES = [1, 2, 3] as const

export interface ExpandDialogProps {
  node: CorrespondenceTreeNode
  /** Every offered engine; the one flagged `default` is preselected. */
  engines: CorrespondenceSearchEngine[]
  /** The deployment's `correspondence_task_multipv`, shown as the width placeholder. */
  defaultWidth: number
  pending: boolean
  error: string | null
  onExpand: (body: CorrespondenceExpand) => void
  onClose: () => void
}

function width(value: string): number | null {
  const parsed = Number(value.trim())
  if (value.trim() === '' || !Number.isFinite(parsed)) return null
  return Math.max(1, Math.min(5, Math.trunc(parsed)))
}

/** Up to `w + w² + w³` positions, which is the number an owner is actually buying. */
export function expansionSize(w: number, stages: number): number {
  let total = 0
  for (let stage = 1; stage <= stages; stage += 1) total += w ** stage
  return total
}

export function ExpandDialog({
  node,
  engines,
  defaultWidth,
  pending,
  error,
  onExpand,
  onClose,
}: ExpandDialogProps) {
  const { t } = useLingui()
  const notate = useNotation()
  const [value, setValue] = useState('')
  const [stages, setStages] = useState(1)
  const [tasks, setTasks] = useState(true)
  const [engineId, setEngineId] = useState<number | null>(preferredEngine(engines, 'task'))

  const chosen = width(value) ?? defaultWidth
  const where = node.san ? notate(node.san) : t`the starting position`
  const evaluated = (node.evals ?? []).length > 0
  // With the tasks off no engine is needed; with them on, one has to be picked.
  const ready = !tasks || engineId !== null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || !ready) return
    onExpand({ width: width(value), stages, tasks, engine_id: tasks ? engineId : null })
  }

  return (
    <Frame
      labelledBy="correspondence-expand-title"
      title={<Trans>Expand…</Trans>}
      description={t`The best moves after ${where} become branches of their own, and an engine looks at each of them.`}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-4">
          <Field id="correspondence-expand-width" label={<Trans>Width</Trans>} className="w-28">
            <Input
              id="correspondence-expand-width"
              type="number"
              min={1}
              max={5}
              inputMode="numeric"
              placeholder={String(defaultWidth)}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Label>
              <Trans>Stages</Trans>
            </Label>
            <div role="group" aria-label={t`Stages`} className="flex gap-1">
              {STAGES.map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={stages === count}
                  onClick={() => setStages(count)}
                  className={cn(
                    'min-w-9 rounded-md border px-2 py-1 font-mono text-[0.6875rem] transition-colors',
                    stages === count
                      ? 'border-accent-teal/40 bg-selected text-ink'
                      : 'border-edge text-dim hover:border-edge-hover hover:text-ink',
                  )}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <p className="max-w-[16rem] pt-6 text-[0.625rem] leading-[1.6] text-dim-2">
            <Trans>
              Up to {expansionSize(chosen, stages)} positions. Your marks change that as it
              goes: an excluded move is skipped, a bad one stops after one stage, and a good
              or interesting one gets a stage and a sibling more.
            </Trans>
          </p>
        </div>

        <label className="flex items-start gap-2 border-t border-hairline pt-3 text-[0.75rem] text-body">
          <input
            type="checkbox"
            checked={tasks}
            onChange={(event) => setTasks(event.target.checked)}
            className="mt-0.5 size-3.5 accent-[var(--bb-accent)]"
          />
          <span className="flex flex-col gap-0.5">
            <Trans>Queue tasks</Trans>
            <span className="text-[0.625rem] leading-[1.5] text-dim-2">
              <Trans>
                Off, the moves go into the tree and nothing is calculated.
              </Trans>
            </span>
          </span>
        </label>

        {tasks ? (
          <div className="flex flex-col gap-1.5">
            <Label>
              <Trans>Engine</Trans>
            </Label>
            <EnginePicker engines={engines} mode="task" value={engineId} onChange={setEngineId} />
            <p className="text-[0.625rem] leading-[1.5] text-dim-2">
              <Trans>
                Every task of this expansion runs on it, the later stages too. A runner's
                engine is allowed: a task is ordinary queue work.
              </Trans>
            </p>
          </div>
        ) : null}

        {evaluated ? null : (
          <p className="text-[0.625rem] leading-[1.55] text-dim-2">
            <Trans>
              No engine has looked at this position yet, so one task is queued on the move
              itself and the branches appear when it answers.
            </Trans>
          </p>
        )}

        {error ? (
          <p role="alert" className="text-[0.6875rem] text-blunder">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Button type="submit" disabled={pending || !ready}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            <Trans>Expand</Trans>
          </Button>
        </div>
      </form>
    </Frame>
  )
}
