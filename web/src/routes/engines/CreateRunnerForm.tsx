import { Copy, Loader2, Plus } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateRunner } from '@/lib/api/queries'
import type { RunnerCreated } from '@/lib/api/types'

/**
 * Register a machine and hand over its token.
 *
 * The token is in the create response and nowhere else — only its SHA-256 is stored — so it
 * is held in this component's own state and dies with the panel. Nothing writes it to the
 * query cache, and there is no second reading of it to offer later.
 */
export function CreateRunnerForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('')
  const [slots, setSlots] = useState('1')
  const [invalid, setInvalid] = useState<string | null>(null)
  const [created, setCreated] = useState<RunnerCreated | null>(null)

  const create = useCreateRunner({ onSuccess: setCreated })

  function submit(event: FormEvent) {
    event.preventDefault()
    const count = Number.parseInt(slots, 10)
    if (!name.trim()) {
      setInvalid('a runner needs a name')
      return
    }
    if (!Number.isFinite(count) || count < 1) {
      setInvalid('a runner needs at least one slot')
      return
    }
    setInvalid(null)
    create.mutate({ name: name.trim(), slots: count })
  }

  if (created) {
    return (
      <div
        aria-live="polite"
        className="flex flex-col gap-3 rounded-xl border border-line bg-panel px-3.5 py-3.5"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-ink">
            {created.runner.name} is registered
          </span>
          <div className="flex-1" />
          <Button type="button" size="sm" onClick={onCancel}>
            Done
          </Button>
        </div>

        <p className="rounded-md border border-mistake/28 bg-mistake/5 px-3 py-2 text-[0.6875rem] leading-[1.6] text-mistake">
          Shown once. Nothing stores it, so nothing can show it again — a lost token is a revoke
          and a new runner.
        </p>

        <CopyField label="Token" value={created.token}>
          <code className="block truncate font-mono text-[0.71875rem] text-ink">
            {created.token}
          </code>
        </CopyField>

        <CopyField label="runner.yaml" value={created.config_yaml}>
          <pre className="overflow-x-auto font-mono text-[0.65625rem] leading-[1.6] text-soft">
            {created.config_yaml}
          </pre>
        </CopyField>

        <p className="text-[0.6875rem] leading-[1.6] text-dim">
          Save that as <span className="font-mono text-soft">runner.yaml</span> on the other
          machine, edit the engine paths, and start it with{' '}
          <span className="font-mono text-soft">blunderbase-runner --config runner.yaml</span>.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-line bg-panel px-3.5 py-3.5"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-xs font-semibold text-ink">Add a runner</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="text-[0.6875rem] text-dim transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_6.875rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-runner-name">Name</Label>
          <Input
            id="add-runner-name"
            value={name}
            spellCheck={false}
            autoComplete="off"
            placeholder="gpu-box"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-runner-slots">Slots</Label>
          <Input
            id="add-runner-slots"
            value={slots}
            inputMode="numeric"
            className="font-mono"
            onChange={(event) => setSlots(event.target.value)}
          />
        </div>
      </div>

      {invalid ? <p className="text-[0.6875rem] text-blunder">{invalid}</p> : null}
      {create.isError ? (
        <p className="text-[0.6875rem] text-blunder">{create.error.message}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <p className="flex-1 text-[0.6875rem] leading-[1.6] text-dim">
          A slot is one engine job or one analysis board. The token is minted here and shown
          once.
        </p>
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          Register
        </Button>
      </div>
    </form>
  )
}

/**
 * A block of text with a Copy button.
 *
 * `navigator.clipboard` needs a secure context, and a self-hosted Blunderbase is often
 * plain HTTP on a LAN, so the old `textarea` + `execCommand` route is the fallback rather
 * than an unexplained no-op.
 */
function CopyField({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children: ReactNode
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      try {
        setCopied(document.execCommand('copy'))
      } catch {
        setCopied(false)
      }
      document.body.removeChild(area)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        <div className="flex-1" />
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <Copy aria-hidden />
          {copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
        </Button>
      </div>
      <div className="rounded-md border border-edge bg-elevated px-3 py-2">{children}</div>
    </div>
  )
}
