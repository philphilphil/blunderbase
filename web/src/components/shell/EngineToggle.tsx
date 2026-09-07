/**
 * ⇧E: the engine, off.
 *
 * One button in the titlebar and one key, because the mode is not about a screen — it is
 * about how the next hour of reading is going to go. Somebody who wants to annotate a game
 * before Stockfish tells them the answer has to be able to say so *before* opening the
 * game, from wherever they are standing, and have it still be true on the next game and
 * after a reload. That is why it is here beside the theme rather than in the board's own
 * toolbar next to Hints, which is the same wish for one position and dies with the route.
 *
 * What it hides is `lib/ui/engineVisibility`'s business; this file is the affordance and
 * the key. Both are needed: a mode with only a shortcut is a mode only its author uses,
 * and a mode with only a button is one you have to reach for the mouse to leave.
 *
 * It stays visible on a phone, unlike the theme control beside it. There is no second copy
 * of it in the rail's footer, and the two screens it changes are exactly the two a phone is
 * most likely to be reading — so the ~26px it costs the row is bought back the first time
 * somebody wants their own verdict to stand.
 *
 * The keypress says what it did. On the game and the library the change is unmissable, but
 * the key works on Settings and on Import too, where nothing on screen would move and a
 * reader would be left wondering whether it had registered — and the answer matters,
 * because the whole point is knowing whether the next game will speak.
 */
import { useLingui } from '@lingui/react/macro'
import { Computer } from 'lucide-react'
import { useEffect } from 'react'

import { toggleEngineHidden, useEngineHidden } from '@/lib/ui/engineVisibility'
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

export function EngineToggle({ className }: { className?: string }) {
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

  const label = hidden ? t`Show the engine (⇧E)` : t`Hide the engine (⇧E)`
  // No toast on this path, unlike the key's: the button that was pressed has already
  // changed under the finger, and a toast for it would be the app reading its own label
  // back at the person who just read it.
  return (
    <button
      type="button"
      onClick={() => toggleEngineHidden()}
      // The button is the engine, not the mode: pressed means the engine is speaking, which
      // is what the lit chip says too.
      aria-pressed={!hidden}
      aria-label={label}
      title={
        hidden
          ? t`The engine is hidden. Press to show it again (⇧E).`
          : t`Hide the engine's evaluations, flags and panels (⇧E)`
      }
      className={cn(
        'flex flex-none items-center rounded-md border px-[0.4375rem] py-[0.3125rem] transition-colors',
        // Lit while the engine is on. It is the ordinary state, so the titlebar carries a
        // lit chip most of the time — which is the right way round for a switch whose icon
        // is the engine itself: the computer is on, and pressing it turns it off. Read the
        // other way (lit while hidden) the same chip would have to mean "the computer you
        // can see is the one that is not talking to you".
        //
        // One icon in both states, so the chip going dark is the whole of the difference
        // and there is nothing else to decode.
        hidden
          ? 'border-edge bg-elevated text-dim hover:border-edge-hover hover:text-ink'
          : 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal',
        className,
      )}
    >
      <Computer className="size-3" aria-hidden />
    </button>
  )
}
