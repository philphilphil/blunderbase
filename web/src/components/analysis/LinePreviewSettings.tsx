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
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Eye, EyeOff } from 'lucide-react'
import type { ReactNode } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { FIELD } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, PickerSelect } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import type { LinePreviewPrefs, RowPreview } from '@/lib/board/linePreview'
import { setLinePreviewPrefs, useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'

/**
 * The one select shape the settings forms use throughout, like `SettingsCheck`: a FIELD
 * (sunk, `--bb-field`), the way `NativeSelect` draws it, at the forms' `h-8`. Kept as a
 * class string for the settings pages that style a `<select>` of their own.
 */
export const SETTINGS_SELECT = cn(FIELD, 'h-8 px-2')

const MODES: { value: RowPreview; label: MessageDescriptor }[] = [
  { value: 'arrows', label: msg`Layered arrows` },
  { value: 'overlay', label: msg`Plan overlay` },
  { value: 'play', label: msg`Playthrough` },
  { value: 'peek', label: msg`Peek board` },
  { value: 'off', label: msg`Nothing` },
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
        <span className="font-mono text-label text-soft">{value}{suffix}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="h-1.5 w-full accent-accent-teal" />
    </div>
  )
}

/**
 * The one checkbox shape the board's settings dialog uses throughout: the app's `Checkbox`
 * (a field-drawn box, its label inside the hit area), not the browser's own blue one.
 */
export function SettingsCheck({ id, label, checked, disabled, onChange }: {
  id: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Checkbox
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next) => onChange(next)}
      label={label}
      className="text-label text-soft enabled:hover:text-ink"
    />
  )
}

/**
 * One group of the board's settings dialog: a heading, a line under it at most, and its
 * controls. Groups on a page are divided by a hairline; the first has none, since the page
 * itself starts there.
 */
export function SettingsSection({ title, hint, children }: {
  title: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-hairline px-5 py-4 first:border-t-0">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-data font-semibold text-ink">{title}</h3>
        {hint ? <p className="text-label text-dim">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

const ROW_MODES: RowPreview[] = ['arrows', 'overlay', 'play', 'peek', 'off']

/**
 * What each mode does, for the picker's `title` — the words, not the vocabulary.
 *
 * Whole sentences rather than the tail of one glued onto a shared opener: a language that
 * is not English does not necessarily put the clause in that order, and a translator given
 * "draws nothing" on its own has nothing to place it against.
 */
const ROW_SAYS: Record<RowPreview, MessageDescriptor> = {
  arrows: msg`Hovering a line draws the whole line as layered arrows.`,
  overlay: msg`Hovering a line shows where the pieces end up.`,
  play: msg`Hovering a line plays the line out on the board.`,
  peek: msg`Hovering a line opens a small board beside the row.`,
  off: msg`Hovering a line draws nothing.`,
}

/** The mode's own name, as the picker spells it beside the eye. */
const ROW_SHORT: Record<RowPreview, MessageDescriptor> = {
  arrows: msg`Arrows`,
  overlay: msg`Overlay`,
  play: msg`Playthrough`,
  peek: msg`Peek`,
  off: msg`Off`,
}

/**
 * What hovering an engine line does, picked where the lines are, next to the gear under
 * the board that opens the rest.
 *
 * It lives here rather than in a panel because both panels that show engine lines read the
 * same preference, and it was previously declared in one of them — so the run panel and the
 * live panel each grew their own copy of the same control. Now the engine pane's strip
 * carries it and the live panel does not; there is one place to change the setting and one
 * place to look for it.
 *
 * A strip picker (`PickerSelect size="strip"`): a value picked from a list, so the ⇅, and no
 * face at rest in a strip of quiet facts, the face arriving on hover and focus. It had been
 * a click-to-cycle word in the accent, which read as a link and hid four of its five values
 * behind repeated clicks. The eye says what the setting is about, struck through while
 * hovering a line draws nothing.
 */
export function LinePreviewRowChip({
  compact = false,
}: {
  /**
   * The eye and ⇅ alone, the mode kept for the title and the list: for a strip that also
   * carries the live search's engine and line-count pickers and has no room for the word.
   * `'narrow'` drops the word only while the strip (an `@container`) is under 22rem: the
   * Run tab's strip at 1280, where the word would push the Analyse button off the pane.
   */
  compact?: boolean | 'narrow'
}) {
  const { t, i18n } = useLingui()
  const prefs = useLinePreviewPrefs()
  const Icon = prefs.row !== 'off' ? Eye : EyeOff
  const mode = i18n._(ROW_SHORT[prefs.row])
  return (
    <PickerSelect
      label={t`Line preview`}
      hideLabel
      size="strip"
      value={prefs.row}
      options={ROW_MODES.map((row) => ({ value: row, label: i18n._(ROW_SHORT[row]) }))}
      onChange={(row) => setLinePreviewPrefs({ row })}
      title={compact ? `${mode}: ${i18n._(ROW_SAYS[prefs.row])}` : i18n._(ROW_SAYS[prefs.row])}
      leading={<Icon className="size-3.5 flex-none text-soft" aria-hidden />}
      className={cn(
        'flex-none',
        compact === 'narrow'
          ? '@max-[22rem]:[&>span.font-medium]:sr-only'
          : compact && '[&>span.font-medium]:sr-only',
      )}
    />
  )
}

/**
 * The line-preview controls: the Line preview page of the board's settings dialog
 * (`components/board/BoardSettings`).
 *
 * Grouped by the question each answers, in the order a reader asks them: what pointing at a
 * line does at all (the mode, with its own sentence under it), how much of it is drawn and
 * how it is marked, what pointing at one move inside a line does, and then the chosen mode's
 * own settings, which only exist for the two modes that have any. It had been one block of
 * eleven controls under one heading, which is how it came to read as the heaviest thing in
 * the dialog. A control that depends on another (the badge label, the look-ahead) is
 * disabled rather than hidden while that one is off, so it is still where it was.
 */
export function LinePreviewFields() {
  const { t, i18n } = useLingui()
  const prefs = useLinePreviewPrefs()
  const set = (patch: Partial<Omit<LinePreviewPrefs, 'play' | 'overlay'>>) => setLinePreviewPrefs(patch)

  return (
    <>
      <SettingsSection title={<Trans>Pointing at a line</Trans>} hint={i18n._(ROW_SAYS[prefs.row])}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="preview-mode">{t`Row hover`}</Label>
          <NativeSelect id="preview-mode" value={prefs.row} onChange={(event) => set({ row: event.target.value as RowPreview })} className="h-8 w-56">
            {MODES.map((mode) => <option key={mode.value} value={mode.value}>{i18n._(mode.label)}</option>)}
          </NativeSelect>
        </div>
      </SettingsSection>

      <SettingsSection title={<Trans>Drawing</Trans>} hint={<Trans>How much of the line is drawn, and how it is marked.</Trans>}>
        <div className="flex max-w-sm">
          <Range id="preview-depth" label={t`Plies drawn`} value={prefs.depth} min={1} max={18} onChange={(depth) => set({ depth })} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <SettingsCheck id="preview-sides" label={t`Colour arrows by side`} checked={prefs.bySide} onChange={(bySide) => set({ bySide })} />
          <SettingsCheck id="preview-fade" label={t`Fade with depth`} checked={prefs.fade} onChange={(fade) => set({ fade })} />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <SettingsCheck id="preview-badges" label={t`Move badges`} checked={prefs.badges} onChange={(badges) => set({ badges })} />
          <div className="flex items-center gap-2">
            <Label htmlFor="preview-labels">{t`Badge label`}</Label>
            <NativeSelect id="preview-labels" value={prefs.labels} disabled={!prefs.badges} onChange={(event) => set({ labels: event.target.value as LinePreviewPrefs['labels'] })} className="h-8 w-40">
              <option value="move">{t`Move number`}</option>
              <option value="ply">{t`Ply count`}</option>
            </NativeSelect>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={<Trans>One move of a line</Trans>} hint={<Trans>Pointing at a single move inside a line.</Trans>}>
        <SettingsCheck id="preview-scrub" label={t`Hover a move to show its position`} checked={prefs.scrub} onChange={(scrub) => set({ scrub })} />
        <div className="flex max-w-sm">
          <Range id="preview-lookahead" label={t`Look-ahead`} value={prefs.lookahead} min={0} max={4} disabled={!prefs.scrub} onChange={(lookahead) => set({ lookahead: lookahead as LinePreviewPrefs['lookahead'] })} />
        </div>
      </SettingsSection>

      {prefs.row === 'play' ? (
        <SettingsSection title={<Trans>Playthrough</Trans>}>
          <div className="flex flex-wrap gap-5">
            <Range id="preview-tempo" label={t`Tempo`} value={prefs.play.tempo} min={100} max={2000} step={50} suffix=" ms" onChange={(tempo) => setLinePreviewPrefs({ play: { tempo } })} />
            <Range id="preview-delay" label={t`Start delay`} value={prefs.play.delay} min={0} max={2000} step={50} suffix=" ms" onChange={(delay) => setLinePreviewPrefs({ play: { delay } })} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <SettingsCheck id="preview-loop" label={t`Loop`} checked={prefs.play.loop} onChange={(loop) => setLinePreviewPrefs({ play: { loop } })} />
            <SettingsCheck id="preview-ahead" label={t`Arrow one move ahead`} checked={prefs.play.ahead} onChange={(ahead) => setLinePreviewPrefs({ play: { ahead } })} />
          </div>
        </SettingsSection>
      ) : null}

      {prefs.row === 'overlay' ? (
        <SettingsSection title={<Trans>Plan overlay</Trans>}>
          <SettingsCheck id="preview-dim" label={t`Dim current pieces`} checked={prefs.overlay.dim} onChange={(dim) => setLinePreviewPrefs({ overlay: { dim } })} />
        </SettingsSection>
      ) : null}
    </>
  )
}
