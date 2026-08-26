import { useEffect, useRef } from 'react'

export interface BoardKeyHandlers {
  /** ← / → */
  step: (delta: number) => void
  /** ↑ / Home and ↓ / End */
  seekStart: () => void
  seekEnd: () => void
  /** `j` and `shift+J` */
  nextFlagged: () => void
  previousFlagged: () => void
  /** `f` */
  flip: () => void
}

/** Typing in a field is never a board shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * The game view's keyboard: arrows step through plies, `j` jumps to the next flagged move,
 * `f` flips the board. Bound on `window` so the shortcuts work wherever focus happens to
 * be — except inside a field, and except when a modifier makes it a browser command.
 */
export function useBoardKeys(handlers: BoardKeyHandlers, enabled = true): void {
  const current = useRef(handlers)
  useEffect(() => {
    current.current = handlers
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      const keys = current.current

      switch (event.key) {
        case 'ArrowLeft':
          keys.step(-1)
          break
        case 'ArrowRight':
          keys.step(1)
          break
        case 'ArrowUp':
        case 'Home':
          keys.seekStart()
          break
        case 'ArrowDown':
        case 'End':
          keys.seekEnd()
          break
        case 'j':
          keys.nextFlagged()
          break
        case 'J':
          keys.previousFlagged()
          break
        case 'f':
        case 'F':
          keys.flip()
          break
        default:
          return
      }
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
