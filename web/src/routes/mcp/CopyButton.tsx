import { useLingui } from '@lingui/react/macro'
import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

/**
 * Copy a string, and say what happened. Every block on the MCP page ends in one of these,
 * so the feedback is identical: "Copied" for 1.8 s, and "No clipboard" when the write is
 * refused — no clipboard permission, or no clipboard at all on an insecure origin, which a
 * self-hosted Blunderbase on a LAN often is. Saying so keeps the button from being a
 * no-op; the text it copies is selectable either way.
 */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useLingui()
  // Resolved here rather than as a default parameter: a default is evaluated before the
  // component body runs, which is before `useLingui` has handed anything back.
  const resting = label ?? t`Copy`
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  async function copy() {
    if (timer.current !== null) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    timer.current = setTimeout(() => setState('idle'), 1_800)
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
      {state === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
      {state === 'copied' ? t`Copied` : state === 'failed' ? t`No clipboard` : resting}
    </Button>
  )
}

/**
 * A titled, copyable block: a line of prose saying what it is for, the text in mono, and a
 * `CopyButton` for exactly that text. The three connect commands and the JSON config are
 * all this shape, so the page reads as one list of things to paste.
 */
export function Snippet({
  title,
  text,
  copyLabel,
  children,
}: {
  title: string
  text: string
  copyLabel: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[0.71875rem] font-semibold text-ink">{title}</h3>
        <div className="flex-1" />
        <CopyButton text={text} label={copyLabel} />
      </div>
      {children ? <p className="text-[0.6875rem] leading-[1.5] text-dim">{children}</p> : null}
      <pre className="overflow-x-auto rounded-lg border border-hairline bg-elevated px-3 py-2.5 font-mono text-[0.65625rem] leading-[1.6] text-soft">
        {text}
      </pre>
    </div>
  )
}
