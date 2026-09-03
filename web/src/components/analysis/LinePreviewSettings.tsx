/**
 * The engine-line-preview preferences — row-hover mode, scrub, depth, colours, playthrough
 * tempo (`lib/board/linePreview.ts`, `lib/board/linePreviewPrefs.ts`).
 *
 * The controls live here; the dialog that holds them is `components/board/BoardSettings`,
 * which reaches the reader through a gear under the board rather than one tucked into a
 * panel header where nobody found it. That is the whole reason this file exports fields
 * instead of a button: these are the one kind of preference you cannot judge away from the
 * thing they change — the answer to "how many plies is too many" is on the board in front
 * of you — so they belong beside the board, not on a settings page.
 *
 * Per-browser (`localStorage`, not `AppSettings`, since screen size and taste are per
 * device), so there is no draft and no Save: every control reads `useLinePreviewPrefs()`
 * and writes straight through `setLinePreviewPrefs`.
 */
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { LinePreviewPrefs, RowPreview } from '@/lib/board/linePreview'
import { setLinePreviewPrefs, useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'

/** The one select shape the board's settings dialog uses throughout, like `SettingsCheck`. */
export const SETTINGS_SELECT =
  'h-8 rounded-md border border-input bg-elevated px-2 text-xs text-soft outline-none'
const SELECT = SETTINGS_SELECT

const MODES: { value: RowPreview; label: string }[] = [
  { value: 'arrows', label: 'Layered arrows' },
  { value: 'overlay', label: 'Plan overlay' },
  { value: 'play', label: 'Playthrough' },
  { value: 'peek', label: 'Peek board' },
  { value: 'off', label: 'Nothing' },
]

/** The one slider shape the board's settings dialog uses throughout, like `SettingsCheck`. */
export function Range({ id, label, value, min, max, step = 1, suffix = '', disabled, onChange }: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className={cn('flex min-w-52 flex-1 flex-col gap-1.5', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="font-mono text-[0.6875rem] text-dim">{value}{suffix}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="h-1.5 w-full accent-accent-teal" />
    </div>
  )
}

/** The one checkbox shape the board's settings dialog uses throughout. */
export function SettingsCheck({ id, label, checked, disabled, onChange }: {
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

/**
 * The line-preview controls, without chrome of their own — a section inside the board's
 * settings dialog (`components/board/BoardSettings`) rather than a dialog in its own right.
 */
export function LinePreviewFields() {
  const prefs = useLinePreviewPrefs()
  const set = (patch: Partial<Omit<LinePreviewPrefs, 'play' | 'overlay'>>) => setLinePreviewPrefs(patch)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="preview-mode">Row hover</Label>
        <select id="preview-mode" value={prefs.row} onChange={(event) => set({ row: event.target.value as RowPreview })} className={cn(SELECT, 'w-56')}>
          {MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap gap-4">
        <SettingsCheck id="preview-scrub" label="Hover a move to show its position" checked={prefs.scrub} onChange={(scrub) => set({ scrub })} />
        <SettingsCheck id="preview-badges" label="Move badges" checked={prefs.badges} onChange={(badges) => set({ badges })} />
        <SettingsCheck id="preview-sides" label="Colour arrows by side" checked={prefs.bySide} onChange={(bySide) => set({ bySide })} />
        <SettingsCheck id="preview-fade" label="Fade with depth" checked={prefs.fade} onChange={(fade) => set({ fade })} />
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
            <SettingsCheck id="preview-loop" label="Loop" checked={prefs.play.loop} onChange={(loop) => setLinePreviewPrefs({ play: { loop } })} />
            <SettingsCheck id="preview-ahead" label="Arrow one move ahead" checked={prefs.play.ahead} onChange={(ahead) => setLinePreviewPrefs({ play: { ahead } })} />
          </div>
        </div>
      ) : null}

      {prefs.row === 'overlay' ? <SettingsCheck id="preview-dim" label="Dim current pieces" checked={prefs.overlay.dim} onChange={(dim) => setLinePreviewPrefs({ overlay: { dim } })} /> : null}
    </div>
  )
}
