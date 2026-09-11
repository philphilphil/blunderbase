/**
 * **Queue task…** and **Refresh subtree…** — one bounded look, or one on every stale
 * position under a move, and the only thing to decide is which engine.
 *
 * A dialog rather than a bare menu verb, because the engine is worth choosing: a task is
 * ordinary queue work and may run on a runner's engine, which a search cannot, and the
 * machine bought for correspondence is usually that runner. Everything else a task takes —
 * the node budget, the line count — is the deployment's and is not asked again here.
 *
 * The two verbs share the dialog because they differ only in how many tasks come out of
 * it; the sentence under the title says which.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { CorrespondenceSearchEngine, CorrespondenceTreeNode } from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'

import { Frame } from './DialogFrame'
import { EnginePicker, preferredEngine } from './EnginePicker'

export type TaskVerb = 'task' | 'refresh'

export interface TaskDialogProps {
  node: CorrespondenceTreeNode
  verb: TaskVerb
  engines: CorrespondenceSearchEngine[]
  pending: boolean
  error: string | null
  onQueue: (engineId: number) => void
  onClose: () => void
}

export function TaskDialog({
  node,
  verb,
  engines,
  pending,
  error,
  onQueue,
  onClose,
}: TaskDialogProps) {
  const { t } = useLingui()
  const notate = useNotation()
  const [engineId, setEngineId] = useState<number | null>(preferredEngine(engines, 'task'))
  const where = node.san ? notate(node.san) : t`the starting position`

  function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || engineId === null) return
    onQueue(engineId)
  }

  return (
    <Frame
      labelledBy="correspondence-task-title"
      title={verb === 'task' ? <Trans>Queue task…</Trans> : <Trans>Refresh subtree…</Trans>}
      description={
        verb === 'task'
          ? t`One bounded look at ${where}, through the analysis queue. It takes no search slot and runs wherever the queue has room.`
          : t`A task on every stale position from ${where} down: too shallow, or judged by a version of the engine you no longer have.`
      }
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>
            <Trans>Engine</Trans>
          </Label>
          <EnginePicker engines={engines} mode="task" value={engineId} onChange={setEngineId} />
          <p className="text-[0.625rem] leading-[1.5] text-dim-2">
            <Trans>
              Any engine that is switched on, on this machine or on a runner. The budget and
              the line count are the ones under Analysis → Correspondence.
            </Trans>
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
          <Button type="submit" disabled={pending || engineId === null}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {verb === 'task' ? <Trans>Queue task</Trans> : <Trans>Refresh</Trans>}
          </Button>
        </div>
      </form>
    </Frame>
  )
}
