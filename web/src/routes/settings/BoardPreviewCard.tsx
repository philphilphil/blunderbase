import { cn } from '@/lib/utils'
import type { LinePreviewPrefs, RowPreview } from '@/lib/board/linePreview'
import { setLinePreviewPrefs, useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

/**
 * The engine-line-preview settings — row-hover mode, scrub, depth, colours, playthrough
 * tempo (`lib/board/linePreview.ts`, `lib/board/linePreviewPrefs.ts`). Its own card, not a
 * fieldset in the form above: the form is the deployment's `AppSettings`, saved with a
 * button, while these are per-browser reading preferences — screen size and taste are per
 * device — that apply the instant they change. There is no draft state and no Save here;
 * every control reads `useLinePreviewPrefs()` and writes straight through
 * `setLinePreviewPrefs`.
 */

const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-elevated px-2 text-xs text-soft outline-none transition-colors hover:border-edge-hover focus-visible:border-accent-teal/50 disabled:opacity-50'

const ROW_OPTIONS: { value: RowPreview; label: string }[] = [
  { value: 'arrows', label: 'Layered arrows' },
  { value: 'overlay', label: 'Plan overlay' },
  { value: 'play', label: 'Playthrough' },
  { value: 'peek', label: 'Peek board' },
  { value: 'off', label: 'Nothing' },
]

const ROW_HINT: Record<RowPreview, string> = {
  arrows: 'Hovering a line draws every ply on the board, thinner and fainter with depth.',
  overlay: 'Hovering a line ghosts each piece onto where the line leaves it, with a trail behind it.',
  play: 'Hovering a line auto-plays it on the board at the tempo below, then snaps back.',
  peek: 'Hovering a line pops up a small board showing where it ends, without touching the main one.',
  off: 'Hovering a line draws nothing on the board.',
}

function RangeField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  format = (each: number) => String(each),
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex w-full max-w-64 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="font-mono text-[0.6875rem] text-dim tabular">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-elevated accent-accent-teal"
      />
    </div>
  )
}

function CheckboxField({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'inline-flex select-none items-center gap-2 text-[0.6875rem] text-soft',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3 accent-accent-teal"
      />
      {label}
    </label>
  )
}

const msFormat = (value: number) => `${value} ms`
const plyFormat = (value: number) => `${value} ${value === 1 ? 'ply' : 'plies'}`

export function BoardPreviewCard() {
  const prefs = useLinePreviewPrefs()

  function set(patch: Partial<Omit<LinePreviewPrefs, 'play' | 'overlay'>>) {
    setLinePreviewPrefs(patch)
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader className="flex-col items-stretch gap-1">
        <CardTitle>Board</CardTitle>
        <CardDescription>
          How the board reacts to hovering an engine line. These live in this browser, not the
          deployment — screen size and taste are per device, so a change here takes hold
          immediately, with no Save.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="line-preview-row">Row hover</Label>
          <select
            id="line-preview-row"
            value={prefs.row}
            onChange={(event) => set({ row: event.target.value as RowPreview })}
            className={cn(SELECT_CLASS, 'w-56')}
          >
            {ROW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-[0.6875rem] leading-[1.5] text-dim-2">{ROW_HINT[prefs.row]}</p>
        </div>

        <div className="flex flex-col gap-3">
          <CheckboxField
            id="line-preview-scrub"
            label="Hovering a move in the line shows the position after it"
            checked={prefs.scrub}
            onChange={(scrub) => set({ scrub })}
          />
          {prefs.scrub ? (
            <RangeField
              id="line-preview-lookahead"
              label="Look-ahead"
              value={prefs.lookahead}
              min={0}
              max={4}
              format={plyFormat}
              onChange={(value) =>
                set({ lookahead: value as LinePreviewPrefs['lookahead'] })
              }
            />
          ) : null}
        </div>

        <RangeField
          id="line-preview-depth"
          label="Plies drawn"
          value={prefs.depth}
          min={1}
          max={18}
          format={plyFormat}
          onChange={(depth) => set({ depth })}
        />

        <div className="flex flex-wrap items-end gap-4">
          <CheckboxField
            id="line-preview-badges"
            label="Badges"
            checked={prefs.badges}
            onChange={(badges) => set({ badges })}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="line-preview-labels">Label style</Label>
            <select
              id="line-preview-labels"
              value={prefs.labels}
              disabled={!prefs.badges}
              onChange={(event) =>
                set({ labels: event.target.value as LinePreviewPrefs['labels'] })
              }
              className={cn(SELECT_CLASS, 'w-44')}
            >
              <option value="move">Move number (7…)</option>
              <option value="ply">Ply count (8)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <CheckboxField
            id="line-preview-by-side"
            label="White's moves teal, Black's lavender"
            checked={prefs.bySide}
            onChange={(bySide) => set({ bySide })}
          />
          <CheckboxField
            id="line-preview-fade"
            label="Fade with depth"
            checked={prefs.fade}
            onChange={(fade) => set({ fade })}
          />
        </div>

        {prefs.row === 'play' ? (
          <div className="flex flex-col gap-3 border-t border-hairline pt-3">
            <div className="flex flex-wrap gap-4">
              <RangeField
                id="line-preview-play-tempo"
                label="Tempo"
                value={prefs.play.tempo}
                min={100}
                max={2000}
                step={50}
                format={msFormat}
                onChange={(tempo) => setLinePreviewPrefs({ play: { tempo } })}
              />
              <RangeField
                id="line-preview-play-delay"
                label="Start delay"
                value={prefs.play.delay}
                min={0}
                max={2000}
                step={50}
                format={msFormat}
                onChange={(delay) => setLinePreviewPrefs({ play: { delay } })}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <CheckboxField
                id="line-preview-play-loop"
                label="Loop when it reaches the end"
                checked={prefs.play.loop}
                onChange={(loop) => setLinePreviewPrefs({ play: { loop } })}
              />
              <CheckboxField
                id="line-preview-play-ahead"
                label="Arrow one move ahead"
                checked={prefs.play.ahead}
                onChange={(ahead) => setLinePreviewPrefs({ play: { ahead } })}
              />
            </div>
          </div>
        ) : null}

        {prefs.row === 'overlay' ? (
          <div className="border-t border-hairline pt-3">
            <CheckboxField
              id="line-preview-overlay-dim"
              label="Dim the current pieces"
              checked={prefs.overlay.dim}
              onChange={(dim) => setLinePreviewPrefs({ overlay: { dim } })}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
