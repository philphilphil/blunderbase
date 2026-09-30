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

import { Button } from '@/components/ui/button'
import { TextLink } from '@/components/ui/text-link'
import { Textarea } from '@/components/ui/textarea'
import { useSaveNote } from '@/lib/api/queries'
import { commitsOnEnter } from '@/lib/ui/shortcuts'

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
        <span className="inline-flex items-center gap-1.5 text-label text-good">
          <Check className="size-3" aria-hidden />
          <Trans>Saved</Trans>
          <TextLink to={`/notes?note=${saved}`}>
            <Trans>open it</Trans>
          </TextLink>
        </span>
      ) : null}

      {/* A secondary face ending in "…": it opens a small form that asks for the words. */}
      <Button
        type="button"
        size="sm"
        variant="secondary"
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
        className="aria-expanded:bg-raised aria-expanded:shadow-none"
      >
        <StickyNote aria-hidden />
        <Trans>Save this moment…</Trans>
      </Button>

      {open ? (
        // The panel hangs off the button's right edge, which is not the screen's — the
        // flip control sits to its right — so below `md` it is narrow enough that 19rem
        // of it cannot reach past the left edge of a phone.
        <div className="bb-pop-in absolute top-[calc(100%+0.375rem)] right-0 z-30 flex w-[19rem] flex-col gap-2 rounded-lg border border-edge bg-elevated p-2.5 shadow-[0_1.125rem_2.5rem_-1.125rem_var(--bb-shadow)] max-md:w-[15rem]">
          <span className="text-label font-medium text-dim">
            <Trans>About this position</Trans>
          </span>
          <Textarea
            autoFocus
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter saves; Shift+Enter is the new line — the same in every note box.
              if (commitsOnEnter(event)) {
                event.preventDefault()
                commit()
              }
            }}
            aria-label={t`Note about this position`}
            placeholder={t`What is worth remembering here?`}
            className="resize-y leading-[1.55]"
          />
          {/* Every form's footer: Cancel as the secondary face, then the one primary. */}
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
              <Trans>Cancel</Trans>
            </Button>
            <Button
              size="sm"
              onClick={commit}
              disabled={save.isPending || !text.trim()}
              title={text.trim() ? undefined : t`Write something first`}
            >
              {save.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              <Trans>Save note</Trans>
            </Button>
          </div>
          {save.isError ? (
            <span className="text-label text-blunder">{save.error.message}</span>
          ) : null}
          <span className="text-meta leading-snug text-dim">
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
