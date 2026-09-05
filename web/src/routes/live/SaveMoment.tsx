/**
 * "Save this moment" — the live board, written down.
 *
 * The one thing this screen could not do: something happens on the coach-driven board and
 * there is nowhere to put the thought about it. `POST /notes {from_live: true}` snapshots
 * the board on the backend rather than here — its FEN, the game it is following and, off
 * the mainline, the departure as a kept line — so the note is pinned to what was actually
 * on the board at that instant and not to whatever this tab last received.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Check, Loader2, StickyNote } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useSaveNote } from '@/lib/api/queries'

export interface SaveMomentProps {
  /** Nothing on the board is nothing to save — the backend would have no position. */
  active: boolean
}

export function SaveMoment({ active }: SaveMomentProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState<number | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const save = useSaveNote()
  const { t } = useLingui()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (host.current && !host.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function commit() {
    const trimmed = text.trim()
    if (!trimmed) return
    save.mutate(
      { text: trimmed, from_live: true },
      {
        onSuccess: (note) => {
          setSaved(note.id)
          setText('')
          setOpen(false)
        },
      },
    )
  }

  return (
    <div ref={host} className="relative flex items-center gap-2">
      {saved !== null && !open ? (
        <span className="inline-flex items-center gap-1.5 text-[0.6875rem] text-good">
          <Check className="size-3" aria-hidden />
          <Trans>Saved</Trans>
          <Link
            to={`/notes?note=${saved}`}
            className="text-accent-teal transition-colors hover:text-accent-link"
          >
            <Trans>open it</Trans>
          </Link>
        </span>
      ) : null}

      <button
        type="button"
        disabled={!active}
        aria-expanded={open}
        title={
          active
            ? t`Write a note about the position on the board`
            : t`Nothing is on the board to write about`
        }
        onClick={() => {
          setSaved(null)
          setOpen((was) => !was)
        }}
        className="inline-flex items-center gap-2 rounded-md border border-edge px-2.5 py-[0.3125rem] text-[0.6875rem] text-soft transition-colors hover:border-edge-hover hover:text-ink disabled:cursor-not-allowed disabled:text-faint"
      >
        <StickyNote className="size-3.5" aria-hidden />
        <Trans>Save this moment</Trans>
      </button>

      {open ? (
        // The panel hangs off the button's right edge, which is not the screen's — the
        // flip control sits to its right — so below `md` it is narrow enough that 19rem
        // of it cannot reach past the left edge of a phone.
        <div className="absolute top-[calc(100%+0.375rem)] right-0 z-30 flex w-[19rem] flex-col gap-2 rounded-lg border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] max-md:w-[15rem]">
          <span className="text-[0.625rem] tracking-[.1em] text-faint uppercase">
            <Trans>About this position</Trans>
          </span>
          <textarea
            autoFocus
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit()
            }}
            aria-label={t`Note about this position`}
            placeholder={t`What is worth remembering here?`}
            className="w-full resize-y rounded-md border border-input bg-panel px-2.5 py-2 text-[0.75rem] leading-[1.55] text-ink outline-none focus-visible:border-accent-teal/50"
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={commit} disabled={save.isPending || !text.trim()}>
              {save.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              <Trans>Save note</Trans>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
          </div>
          {save.isError ? (
            <span className="text-[0.6875rem] text-blunder">{save.error.message}</span>
          ) : null}
          <span className="text-[0.625rem] leading-snug text-dim">
            <Trans>
              The board's position is taken on the server, along with the game it is following
              and any line it has wandered into.
            </Trans>
          </span>
        </div>
      ) : null}
    </div>
  )
}
