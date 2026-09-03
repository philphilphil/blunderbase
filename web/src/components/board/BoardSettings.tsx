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
 * Three sections, in the order the reader meets them: what the board says about *this*
 * position — the standing arrows — then the shape the evaluation pane draws the game in,
 * and then what the board does when a line in a panel is pointed at. The graph joined them
 * for the same reason the other two are here: it is judged by looking at it, and the gear
 * that opens this is the nearest control to it. None of the three has a Save: every store
 * writes straight through, so what is behind the dialog changes as the controls are used.
 * The dialog is deliberately not modal-looking on its left edge for that reason — it is
 * narrow and centred, and closing it is Escape, the X, or a click on the backdrop.
 *
 * The words are rationed on purpose. A control whose label needs a paragraph is the wrong
 * control; a section gets one short line at most, and everything else it might have said is
 * visible on the board the moment the box is ticked, which is what this dialog is placed
 * beside. That reasoning stays here in the source, where it costs the reader nothing.
 */
import { Settings2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  LinePreviewFields,
  SettingsCheck,
  SETTINGS_SELECT,
} from '@/components/analysis/LinePreviewSettings'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { setBoardArrowPrefs, useBoardArrowPrefs } from '@/lib/board/arrowPrefs'
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
const ARROWS = [
  { key: 'engine' as const, label: 'Engine move', swatch: 'var(--bb-arrow-engine)' },
  { key: 'maia' as const, label: 'Maia move', swatch: 'var(--bb-arrow-maia)' },
  { key: 'played' as const, label: 'Played move', swatch: 'var(--bb-arrow-played)' },
]

/** The two shapes the evaluation pane can draw. The option names are the explanation. */
const GRAPH_STYLES: { value: EvalGraphStyle; label: string }[] = [
  { value: 'bars', label: 'Bars — one per move' },
  { value: 'area', label: 'Filled curve' },
]

/** What a flagged move is marked with, quietest first. */
const GRAPH_MARKS: { value: EvalGraphMarks; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'dots', label: 'Dots' },
  { value: 'glyphs', label: 'Glyphs' },
]

export function BoardSettingsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const arrows = useBoardArrowPrefs()
  const graph = useEvalGraphPrefs()

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
        aria-label="Board settings"
        title="Board settings — arrows, the eval graph and line preview"
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
                  Board
                </h2>
                <p className="text-[0.6875rem] text-dim">This browser only.</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden />
              </Button>
            </header>

            <section className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[0.75rem] font-semibold text-ink">Arrows</h3>
                <p className="text-[0.6875rem] text-dim">
                  Drawn on the position the board is showing.
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
                      label={arrow.label}
                      checked={arrows[arrow.key]}
                      onChange={(on) => setBoardArrowPrefs({ [arrow.key]: on })}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-3 border-t border-hairline px-4 py-4">
              <h3 className="text-[0.75rem] font-semibold text-ink">Evaluation graph</h3>
              {/* Two fields on their own line under the heading, each named by its own
                  label — the section title cannot label two controls, and a word over a
                  select is shorter than a sentence beside it. */}
              <div className="flex flex-wrap gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="eval-graph-style">Shape</Label>
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
                        {style.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="eval-graph-marks">Marks</Label>
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
                        {mark.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3 border-t border-hairline px-4 py-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[0.75rem] font-semibold text-ink">Line preview</h3>
                <p className="text-[0.6875rem] text-dim">
                  What pointing at an engine line does to the board.
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
