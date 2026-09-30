/**
 * ⇧E: the engine, off.
 *
 * One switch in the titlebar and one key, because the mode is not about a screen — it is
 * about how the next hour of reading is going to go. Somebody who wants to annotate a game
 * before Stockfish tells them the answer has to be able to say so *before* opening the
 * game, from wherever they are standing, and have it still be true on the next game and
 * after a reload. That is why it is the one global in the bar rather than in the board's
 * own toolbar next to Hints, which is the same wish for one position and dies with the route.
 *
 * A labelled switch, "Hide engine", off by default. It used to be a lit `Computer` chip,
 * lit while the engine spoke: a permanent accent block beside every page's primary, a glyph
 * that read as the theme's monitor, and on pages with no evaluations it read as "stop
 * Stockfish". Now the ordinary state is a grey track, and the unusual spoiler-free mode is
 * the one that lights, named by its own words; on is `aria-checked`, and it means hidden.
 *
 * What it hides is `lib/ui/engineVisibility`'s business; this file is the affordance and
 * the key. Both are needed: a mode with only a shortcut is a mode only its author uses,
 * and a mode with only a button is one you have to reach for the mouse to leave.
 *
 * It stays in the bar on a phone, without its word (`compact`: an eye in the thumb and the
 * name for screen readers). There is no second copy of it anywhere, and the two screens it
 * changes are exactly the two a phone is most likely to be reading.
 *
 * The keypress says what it did. On the game and the library the change is unmissable, but
 * the key works on Settings and on Import too, where nothing on screen would move and a
 * reader would be left wondering whether it had registered — and the answer matters,
 * because the whole point is knowing whether the next game will speak.
 */
import { useLingui } from '@lingui/react/macro'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect } from 'react'

import { Switch } from '@/components/ui/switch'
import { setEngineHidden, toggleEngineHidden, useEngineHidden } from '@/lib/ui/engineVisibility'
import { isTyping } from '@/lib/ui/shortcuts'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/**
 * Shift and an E, however the keyboard spells it.
 *
 * `event.key` is `E` for shift+e and `e` when Caps Lock has already done the shifting, so
 * the letter is folded and Shift is asked for on its own — the same rule `chordOf` writes
 * down, applied here because this binding is the shell's rather than the board's.
 */
function isEngineChord(event: KeyboardEvent): boolean {
  if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false
  return event.key.toLowerCase() === 'e'
}

export function EngineToggle({
  compact = false,
  className,
}: {
  /** The phone bar's form: no word beside the track, an eye inside the thumb. */
  compact?: boolean
  className?: string
}) {
  const hidden = useEngineHidden()
  const { t } = useLingui()

  // Resolved during the render rather than inside the handler, so the listener depends on
  // plain strings and is renewed when the language changes and at no other time.
  const hiddenSaid = t`Engine hidden. Nothing gives the game away.`
  const shownSaid = t`Engine back. Evaluations and flags are on again.`
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isEngineChord(event)) return
      // A capital E belongs to whoever is typing one.
      if (isTyping(event.target)) return
      event.preventDefault()
      toast.info(toggleEngineHidden() ? hiddenSaid : shownSaid)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [hiddenSaid, shownSaid])

  // No toast on this path, unlike the key's: the switch that was pressed has already
  // changed under the finger, and a toast for it would be the app reading its own label
  // back at the person who just read it.
  const Glyph = hidden ? EyeOff : Eye
  return (
    <Switch
      checked={hidden}
      onCheckedChange={(next) => setEngineHidden(next)}
      label={t`Hide engine`}
      hideLabel={compact}
      title={t`Hide engine evaluations, lines and flags (⇧E)`}
      thumbIcon={
        compact ? (
          <Glyph
            aria-hidden
            strokeWidth={3}
            className={hidden ? 'size-2 text-accent-ink' : 'size-2 text-panel'}
          />
        ) : undefined
      }
      // The word first, then the track: the bar reads left to right into its last control.
      className={cn('flex-row-reverse', className)}
    />
  )
}
