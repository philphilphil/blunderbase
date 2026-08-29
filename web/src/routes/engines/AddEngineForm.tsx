import { useMutation } from '@tanstack/react-query'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { probeEngine } from '@/lib/api/endpoints'
import { useAddEngine } from '@/lib/api/queries'
import type { EngineKind, EngineResponse, ProbeResponse } from '@/lib/api/types'

/**
 * Add an engine by path.
 *
 * The backend probes on the way in and refuses a binary it cannot start, so the Probe
 * button is not a formality: it is the same check, run early, with the engine's own name
 * and option count as the receipt.
 *
 * Kind is the only thing the form says about what the engine is *for*, and it says it in
 * the owner's words rather than the protocol's — a normal engine, or one that plays like a
 * person. Which job it does is not asked here: a new engine fills any role still empty
 * (`services.engines.assign_default_roles`), and the rest is decided under "What runs what"
 * where all three roles are seen together.
 */
export function AddEngineForm({
  onAdded,
  onCancel,
}: {
  onAdded: (engine: EngineResponse) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<EngineKind>('uci')
  const [invalid, setInvalid] = useState<string | null>(null)

  const probe = useMutation<ProbeResponse, Error, void>({
    mutationFn: () => probeEngine({ path: path.trim(), kind }),
    onSuccess: (result) => {
      if (!name.trim() && result.name) setName(result.name.slice(0, 64))
    },
  })
  const add = useAddEngine({ onSuccess: onAdded })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !path.trim()) {
      setInvalid('an engine needs a name and a path')
      return
    }
    setInvalid(null)
    add.mutate({ name: name.trim(), path: path.trim(), kind, enabled: true })
  }

  const declared = probe.data?.options?.length ?? 0

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-line bg-panel px-3.5 py-3.5"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-semibold text-ink">Add an engine</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="text-[0.6875rem] text-dim transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-engine-path">Path</Label>
        <div className="flex gap-2">
          <Input
            id="add-engine-path"
            value={path}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            placeholder="/opt/homebrew/bin/stockfish"
            onChange={(event) => {
              setPath(event.target.value)
              probe.reset()
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!path.trim() || probe.isPending}
            onClick={() => probe.mutate()}
          >
            {probe.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
            Probe
          </Button>
        </div>
      </div>

      {probe.isError ? (
        <div className="rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
          <p className="text-[0.75rem] text-blunder">That binary could not be started.</p>
          <p className="mt-1 font-mono text-[0.6875rem] leading-[1.5] text-blunder/80">
            {probe.error.message}
          </p>
        </div>
      ) : null}

      {probe.isSuccess ? (
        <div className="flex items-center gap-2.5 rounded-md border border-good/30 bg-good/8 px-3 py-2">
          <Check className="size-3.5 flex-none text-good" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-[0.71875rem] text-good">
            {probe.data.name ?? 'unnamed engine'}
          </span>
          <span className="font-mono text-[0.65625rem] text-good/70 tabular">
            {declared} option{declared === 1 ? '' : 's'}
          </span>
        </div>
      ) : null}

      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_11.25rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-engine-name">Name</Label>
          <Input
            id="add-engine-name"
            value={name}
            spellCheck={false}
            placeholder="Stockfish 17"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-engine-kind">Kind</Label>
          <select
            id="add-engine-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as EngineKind)}
            className="h-8 rounded-md border border-input bg-elevated px-2 text-xs text-ink outline-none transition-colors focus-visible:border-accent-teal/50"
          >
            <option value="uci">Normal engine</option>
            <option value="maia">Human moves (Maia)</option>
          </select>
        </div>
      </div>

      {invalid ? <p className="text-[0.6875rem] text-blunder">{invalid}</p> : null}
      {add.isError ? <p className="text-[0.6875rem] text-blunder">{add.error.message}</p> : null}

      <div className="flex items-center gap-2">
        <p className="flex-1 text-[0.6875rem] text-dim">
          A Maia model is a network behind an lc0-style binary — give the command line as
          the path.
        </p>
        <Button type="submit" size="sm" disabled={add.isPending}>
          {add.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Add engine
        </Button>
      </div>
    </form>
  )
}
