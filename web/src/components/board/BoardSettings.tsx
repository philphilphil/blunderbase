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
 * Two sections, in the order the reader meets them: what the board says about *this*
 * position — the standing arrows — and then what it does when a line in a panel is pointed
 * at. Neither has a Save: both stores write straight through, so the board behind the
 * dialog changes as the boxes are ticked. The dialog is deliberately not modal-looking on
 * its left edge for that reason — it is narrow and centred, and closing it is Escape, the
 * X, or a click on the backdrop.
 */
import { Settings2, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { LinePreviewFields, SettingsCheck } from '@/components/analysis/LinePreviewSettings'
import { Button } from '@/components/ui/button'
import { setBoardArrowPrefs, useBoardArrowPrefs } from '@/lib/board/arrowPrefs'
import { cn } from '@/lib/utils'

/**
 * The three standing arrows, each with the colour it is drawn in beside its name — the
 * legend and the switch in one row, so there is nowhere else to look up what the blue one
 * meant. The swatches read the `--bb-arrow-*` family, not the panel colours those hues come
 * from, so the dot here is exactly the arrow on the board rather than a saturated cousin.
 */
const ARROWS = [
  {
    key: 'engine' as const,
    label: 'Engine move',
    swatch: 'var(--bb-arrow-engine)',
    says: "What the engine plays in the position on the board.",
  },
  {
    key: 'maia' as const,
    label: 'Maia move',
    swatch: 'var(--bb-arrow-maia)',
    says: 'What a human of the chosen level is most likely to play here.',
  },
  {
    key: 'played' as const,
    label: 'Played move',
    swatch: 'var(--bb-arrow-played)',
    says: 'The move the game actually went on to play from here.',
  },
]

export function BoardSettingsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const arrows = useBoardArrowPrefs()

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
        title="Board settings — arrows and line preview"
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
                <p className="text-[0.6875rem] text-dim">
                  What this browser draws on the board. Changes apply immediately.
                </p>
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
                  Standing arrows on the position the board is showing. Where two of them
                  name the same move only one arrow is drawn, and it carries a small
                  <span className="font-semibold text-soft"> P </span>
                  when that move is the one the game played.
                </p>
              </div>
              <div className="flex flex-col gap-2">
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
                    <span className="text-[0.6875rem] text-dim">{arrow.says}</span>
                  </div>
                ))}
              </div>
              <p className="text-[0.6875rem] text-faint">
                The <span className="text-dim">Hints</span> button beside this gear switches
                all three off at once, along with the engine and Maia columns — for reading a
                position before being told the answer.
              </p>
            </section>

            <section className="flex flex-col gap-3 border-t border-hairline px-4 py-4">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-[0.75rem] font-semibold text-ink">Line preview</h3>
                <p className="text-[0.6875rem] text-dim">
                  What pointing at a line in one of the engine panels does to the board.
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
