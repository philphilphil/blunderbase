/**
 * Everything that changes what the board draws, behind one gear under the board.
 *
 * There were two problems with where these lived before. The engine-line-preview settings
 * were behind a 14px gear in a panel header — a good dialog nobody would ever find — and
 * the three standing arrows had no control at all beyond the all-or-nothing `Hints`
 * switch. Both are the same kind of preference (per-browser, judged by looking at the
 * board while you change them), so they are one dialog, opened from the transport row
 * where the reader's hand already is for Flip and the step buttons.
 *
 * Four sections, in the order the reader meets them: what the board says about *this*
 * position — the standing arrows — then the click it makes as a move lands, then the shape
 * the evaluation pane draws the game in, and then what the board does when a line in a panel
 * is pointed at. The first two are the board itself, the last two the panels around it. The
 * graph joined them for the same reason the others are here: it is judged by looking at it,
 * and the gear that opens this is the nearest control to it. None of them has a Save: every store
 * writes straight through, so what is behind the dialog changes as the controls are used.
 * The dialog is deliberately not modal-looking on its left edge for that reason — it is
 * narrow and centred, and closing it is Escape, the X, or a click on the backdrop.
 *
 * The words are rationed on purpose. A control whose label needs a paragraph is the wrong
 * control; a section gets one short line at most, and everything else it might have said is
 * visible on the board the moment the box is ticked, which is what this dialog is placed
 * beside. That reasoning stays here in the source, where it costs the reader nothing.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { Settings2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  LinePreviewFields,
  Range,
  SettingsCheck,
  SETTINGS_SELECT,
} from '@/components/analysis/LinePreviewSettings'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { setBoardArrowPrefs, useBoardArrowPrefs } from '@/lib/board/arrowPrefs'
import { playMoveSound } from '@/lib/board/moveSound'
import {
  MOVE_SOUND_STEP,
  setMoveSoundPrefs,
  useMoveSoundPrefs,
} from '@/lib/board/moveSoundPrefs'
import {
  setEvalGraphPrefs,
  useEvalGraphPrefs,
  type EvalGraphMarks,
  type EvalGraphStyle,
} from '@/lib/ui/evalGraphPrefs'
import { cn } from '@/lib/utils'

/**
 * The three standing arrows, each with the colour it is drawn in beside its name — the
 * legend and the switch in one row, so there is nowhere else to look up what the blue one
 * meant. The swatches read the `--bb-arrow-*` family, not the panel colours those hues come
 * from, so the dot here is exactly the arrow on the board rather than a saturated cousin.
 *
 * A dot and three words each. The sentence that used to follow every row said what the
 * board says better: tick the box and the arrow appears on the position in front of you.
 */
const ARROWS: { key: 'engine' | 'maia' | 'played'; label: MessageDescriptor; swatch: string }[] = [
  { key: 'engine', label: msg`Engine move`, swatch: 'var(--bb-arrow-engine)' },
  { key: 'maia', label: msg`Maia move`, swatch: 'var(--bb-arrow-maia)' },
  { key: 'played', label: msg`Played move`, swatch: 'var(--bb-arrow-played)' },
]

/** The two shapes the evaluation pane can draw. The option names are the explanation. */
const GRAPH_STYLES: { value: EvalGraphStyle; label: MessageDescriptor }[] = [
  { value: 'bars', label: msg`Bars — one per move` },
  { value: 'area', label: msg`Filled curve` },
]

/** What a flagged move is marked with, quietest first. */
const GRAPH_MARKS: { value: EvalGraphMarks; label: MessageDescriptor }[] = [
  { value: 'none', label: msg`None` },
  { value: 'dots', label: msg`Dots` },
  { value: 'glyphs', label: msg`Glyphs` },
]

/**
 * The one board-settings button on the screen, named so a key can press it.
 *
 * `s` opens the panel by pressing this rather than by lifting the open/closed state up to
 * the page: the button owns the panel, and a second way in would be a second thing to keep
 * in step with it. Escape closes it, which is the panel's own business either way.
 */
export const BOARD_SETTINGS_ID = 'board-settings-button'

export function BoardSettingsButton({ className }: { className?: string }) {
  const { t, i18n } = useLingui()
  const [open, setOpen] = useState(false)
  const arrows = useBoardArrowPrefs()
  const sound = useMoveSoundPrefs()
  const graph = useEvalGraphPrefs()

  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [open])

  /*
   * The volume control plays what it is setting. There is no other way to know: a number
   * between 0 and 100 says nothing about how loud a room is, and a slider you cannot hear is
   * one you drag, close, step a move, reopen and drag again.
   *
   * Trailing rather than on every step. A sweep across the track fires a change every five
   * percent, and twenty clicks in half a second is a texture, not a level — what you want to
   * hear is the value you *landed* on. So each change cancels the pending click and books
   * another, which makes a slow deliberate drag click per step (every pause outlasts the
   * wait) and a fast sweep click once, at the end. 90 ms is under the threshold where a
   * control feels laggy and well over the length of the click itself.
   */
  const pending = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (pending.current !== null) clearTimeout(pending.current)
    },
    [],
  )
  const previewSound = (volume: number) => {
    if (pending.current !== null) clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      playMoveSound('move', volume)
    }, 90)
  }

  return (
    <>
      <button
        type="button"
        id={BOARD_SETTINGS_ID}
        data-tour="board-settings"
        aria-label={t`Board settings`}
        title={t`Board settings — arrows, sound, the eval graph and line preview (S)`}
        onClick={() => setOpen(true)}
        className={cn(
          'flex-none rounded-md border border-edge bg-elevated px-2 py-[0.3125rem] text-dim transition-colors hover:text-ink max-md:py-1.5',
          className,
        )}
      >
        <Settings2 className="size-3.5" aria-hidden />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-void/75 px-6 py-[8vh]"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="board-settings-title"
            className="bb-card flex w-full max-w-2xl flex-col shadow-[0_1rem_3rem_var(--bb-shadow)]"
          >
            <header className="flex items-start gap-3 border-b border-hairline px-4 py-3.5">
              <div className="flex flex-1 flex-col gap-1">
                <h2 id="board-settings-title" className="text-sm font-semibold text-ink">
                  <Trans>Board</Trans>
                </h2>
                <p className="text-[0.6875rem] text-dim">
                  <Trans>This browser only.</Trans>
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t`Close`}
                onClick={() => setOpen(false)}
              >
                <X aria-hidden />
              </Button>
            </header>

            <section className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[0.75rem] font-semibold text-ink">
                  <Trans>Arrows</Trans>
                </h3>
                <p className="text-[0.6875rem] text-dim">
                  <Trans>Drawn on the position the board is showing.</Trans>
                </p>
              </div>
              {/* One wrapping line now that the sentences are gone: three switches, read
                  across in a glance, rather than three stacked paragraphs. */}
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {ARROWS.map((arrow) => (
                  <div key={arrow.key} className="flex items-baseline gap-2">
                    <span
                      aria-hidden
                      className="size-2 flex-none translate-y-px rounded-full"
                      style={{ background: arrow.swatch }}
                    />
                    <SettingsCheck
                      id={`board-arrow-${arrow.key}`}
                      label={i18n._(arrow.label)}
                      checked={arrows[arrow.key]}
                      onChange={(on) => setBoardArrowPrefs({ [arrow.key]: on })}
                    />
                  </div>
                ))}
              </div>
            </section>

            {/* Beside the arrows rather than at the end: both are what the board itself does
                as the reader steps through the game, where the two sections below are about
                what the panels draw. The slider is disabled rather than hidden while the
                sound is off — a control that vanishes is a control nobody finds twice — and
                it plays as it is dragged (see `previewSound` above), which is the only way
                anyone has ever set a volume. */}
            <section className="flex flex-col gap-3 border-t border-hairline px-4 py-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[0.75rem] font-semibold text-ink">
                  <Trans>Sound</Trans>
                </h3>
                <p className="text-[0.6875rem] text-dim">
                  <Trans>A click as each move lands.</Trans>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <SettingsCheck
                  id="board-sound-enabled"
                  label={t`Move sounds`}
                  checked={sound.enabled}
                  onChange={(on) => {
                    setMoveSoundPrefs({ enabled: on })
                    // Ticking the box answers itself: you hear the thing you just turned on.
                    if (on) previewSound(sound.volume)
                  }}
                />
                <Range
                  id="board-sound-volume"
                  label={t`Level`}
                  value={sound.volume}
                  min={0}
                  max={100}
                  step={MOVE_SOUND_STEP}
                  suffix="%"
                  disabled={!sound.enabled}
                  onChange={(volume) => {
                    setMoveSoundPrefs({ volume })
                    previewSound(volume)
                  }}
                />
              </div>
            </section>

            <section className="flex flex-col gap-3 border-t border-hairline px-4 py-4">
              <h3 className="text-[0.75rem] font-semibold text-ink">
                <Trans>Evaluation graph</Trans>
              </h3>
              {/* Two fields on their own line under the heading, each named by its own
                  label — the section title cannot label two controls, and a word over a
                  select is shorter than a sentence beside it. */}
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="eval-graph-style">{t`Shape`}</Label>
                  <select
                    id="eval-graph-style"
                    value={graph.style}
                    onChange={(event) =>
                      setEvalGraphPrefs({ style: event.target.value as EvalGraphStyle })
                    }
                    className={cn(SETTINGS_SELECT, 'w-48')}
                  >
                    {GRAPH_STYLES.map((style) => (
                      <option key={style.value} value={style.value}>
                        {i18n._(style.label)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="eval-graph-marks">{t`Marks`}</Label>
                  <select
                    id="eval-graph-marks"
                    value={graph.marks}
                    onChange={(event) =>
                      setEvalGraphPrefs({ marks: event.target.value as EvalGraphMarks })
                    }
                    className={cn(SETTINGS_SELECT, 'w-36')}
                  >
                    {GRAPH_MARKS.map((mark) => (
                      <option key={mark.value} value={mark.value}>
                        {i18n._(mark.label)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3 border-t border-hairline px-4 py-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[0.75rem] font-semibold text-ink">
                  <Trans>Line preview</Trans>
                </h3>
                <p className="text-[0.6875rem] text-dim">
                  <Trans>What pointing at an engine line does to the board.</Trans>
                </p>
              </div>
              <LinePreviewFields />
            </section>
          </div>
        </div>
      ) : null}
    </>
  )
}
