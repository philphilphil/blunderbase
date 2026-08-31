/**
 * The engine-line-preview preferences — row-hover mode, scrub, depth, colours, playthrough
 * tempo (`lib/board/linePreview.ts`, `lib/board/linePreviewPrefs.ts`).
 *
 * A gear beside the panel rather than a card on a settings page, because these are the one
 * kind of preference you cannot judge away from the thing they change: the answer to "how
 * many plies is too many" is on the board in front of you. They are per-browser too —
 * `localStorage`, not `AppSettings`, since screen size and taste are per device — so there
 * is no draft and no Save: every control reads `useLinePreviewPrefs()` and writes straight
 * through `setLinePreviewPrefs`, so closing the dialog is all it takes to see the change.
 */
import { Settings2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { LinePreviewPrefs, RowPreview } from '@/lib/board/linePreview'
import { setLinePreviewPrefs, useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'

const SELECT = 'h-8 rounded-md border border-input bg-elevated px-2 text-xs text-soft outline-none'

const MODES: { value: RowPreview; label: string }[] = [
  { value: 'arrows', label: 'Layered arrows' },
  { value: 'overlay', label: 'Plan overlay' },
  { value: 'play', label: 'Playthrough' },
  { value: 'peek', label: 'Peek board' },
  { value: 'off', label: 'Nothing' },
]

function Range({ id, label, value, min, max, step = 1, suffix = '', onChange }: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex min-w-52 flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="font-mono text-[0.6875rem] text-dim">{value}{suffix}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-1.5 w-full accent-accent-teal" />
    </div>
  )
}

function Check({ id, label, checked, disabled, onChange }: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label htmlFor={id} className={cn('inline-flex items-center gap-2 text-[0.6875rem] text-soft', disabled && 'opacity-50')}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-3 accent-accent-teal" />
      {label}
    </label>
  )
}

const ROW_MODES: RowPreview[] = ['arrows', 'overlay', 'play', 'peek', 'off']

/** What each mode does, for the chip's `title` — the words, not the vocabulary. */
const ROW_SAYS: Record<RowPreview, string> = {
  arrows: 'draws the whole line as layered arrows',
  overlay: 'shows where the pieces end up',
  play: 'plays the line out on the board',
  peek: 'opens a small board beside the row',
  off: 'draws nothing',
}

/**
 * The one-click cycler for what hovering a line does, next to the gear that opens the rest.
 *
 * It lives here rather than in a panel because both panels that show engine lines read the
 * same preference, and it was previously declared in one of them — so the run panel and the
 * live panel each grew their own copy of the same control. Now the run panel's Stockfish
 * card carries the pair and the live panel carries neither; there is one place to change
 * the setting and one place to look for it.
 */
export function LinePreviewRowChip() {
  const prefs = useLinePreviewPrefs()
  return (
    <button
      type="button"
      onClick={() =>
        setLinePreviewPrefs({
          row: ROW_MODES[(ROW_MODES.indexOf(prefs.row) + 1) % ROW_MODES.length]!,
        })
      }
      title={`Hovering a line ${ROW_SAYS[prefs.row]}. Click to cycle.`}
      className="bb-chip flex-none px-1.5 py-px font-mono text-[0.625rem] text-dim transition-colors hover:text-ink"
    >
      {prefs.row}
    </button>
  )
}

export function LinePreviewSettingsButton() {
  const [open, setOpen] = useState(false)
  const prefs = useLinePreviewPrefs()
  const set = (patch: Partial<Omit<LinePreviewPrefs, 'play' | 'overlay'>>) => setLinePreviewPrefs(patch)

  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label="Line preview settings"
        title="Line preview settings"
        onClick={() => setOpen(true)}
        className="text-faint transition-colors hover:text-ink"
      >
        <Settings2 className="size-3.5" aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-void/75 px-6 py-[8vh]" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="line-preview-title" className="bb-card flex w-full max-w-2xl flex-col shadow-[0_1rem_3rem_var(--bb-shadow)]">
            <header className="flex items-start gap-3 border-b border-hairline px-4 py-3.5">
              <div className="flex flex-1 flex-col gap-1">
                <h2 id="line-preview-title" className="text-sm font-semibold text-ink">Line preview</h2>
                <p className="text-[0.6875rem] text-dim">How this browser previews engine lines on the board. Changes apply immediately.</p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}><X aria-hidden /></Button>
            </header>

            <div className="flex flex-col gap-5 px-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="preview-mode">Row hover</Label>
                <select id="preview-mode" value={prefs.row} onChange={(event) => set({ row: event.target.value as RowPreview })} className={cn(SELECT, 'w-56')}>
                  {MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                </select>
              </div>

              <div className="flex flex-wrap gap-4">
                <Check id="preview-scrub" label="Hover a move to show its position" checked={prefs.scrub} onChange={(scrub) => set({ scrub })} />
                <Check id="preview-badges" label="Move badges" checked={prefs.badges} onChange={(badges) => set({ badges })} />
                <Check id="preview-sides" label="Colour arrows by side" checked={prefs.bySide} onChange={(bySide) => set({ bySide })} />
                <Check id="preview-fade" label="Fade with depth" checked={prefs.fade} onChange={(fade) => set({ fade })} />
              </div>

              <div className="flex flex-wrap gap-5">
                <Range id="preview-depth" label="Plies drawn" value={prefs.depth} min={1} max={18} onChange={(depth) => set({ depth })} />
                {prefs.scrub ? <Range id="preview-lookahead" label="Look-ahead" value={prefs.lookahead} min={0} max={4} onChange={(lookahead) => set({ lookahead: lookahead as LinePreviewPrefs['lookahead'] })} /> : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="preview-labels">Badge label</Label>
                <select id="preview-labels" value={prefs.labels} disabled={!prefs.badges} onChange={(event) => set({ labels: event.target.value as LinePreviewPrefs['labels'] })} className={cn(SELECT, 'w-48')}>
                  <option value="move">Move number</option>
                  <option value="ply">Ply count</option>
                </select>
              </div>

              {prefs.row === 'play' ? (
                <div className="flex flex-col gap-4 border-t border-hairline pt-4">
                  <div className="flex flex-wrap gap-5">
                    <Range id="preview-tempo" label="Tempo" value={prefs.play.tempo} min={100} max={2000} step={50} suffix=" ms" onChange={(tempo) => setLinePreviewPrefs({ play: { tempo } })} />
                    <Range id="preview-delay" label="Start delay" value={prefs.play.delay} min={0} max={2000} step={50} suffix=" ms" onChange={(delay) => setLinePreviewPrefs({ play: { delay } })} />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <Check id="preview-loop" label="Loop" checked={prefs.play.loop} onChange={(loop) => setLinePreviewPrefs({ play: { loop } })} />
                    <Check id="preview-ahead" label="Arrow one move ahead" checked={prefs.play.ahead} onChange={(ahead) => setLinePreviewPrefs({ play: { ahead } })} />
                  </div>
                </div>
              ) : null}

              {prefs.row === 'overlay' ? <Check id="preview-dim" label="Dim current pieces" checked={prefs.overlay.dim} onChange={(dim) => setLinePreviewPrefs({ overlay: { dim } })} /> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
