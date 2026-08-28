/**
 * The hovered engine line, as a board shows it.
 *
 * `./linePreview` says what a preview *is* — the replay, the shapes, the transient position
 * — as pure functions of a state that somebody has to hold. This is where it is held: the
 * playthrough's timer, the ply a wheel has walked to, and the bookkeeping that keeps both
 * of them honest while a live search rewrites its lines several times a second.
 *
 * Three things can name the ply the preview stands on, and they are ranked rather than
 * merged. A wheel wins over everything: it is a deliberate act, and it stops the
 * playthrough the moment it arrives. A hovered token comes next — the pointer is on that
 * move right now. The playthrough's own tick is last, because nothing the reader did says
 * where it is. With none of them the preview stands on the row alone, which is what the
 * whole-line modes (arrows, overlay) draw.
 *
 * Everything transient is keyed on the position *and* the line's own moves, so a line the
 * engine has since rewritten cannot be scrubbed: the ply is simply not this line's any
 * more, and the preview falls back to the row. That check is a string comparison rather
 * than object identity on purpose — the panel builds a fresh `HoveredLine` on every render.
 */
import type { DrawShape } from '@lichess-org/chessground/draw'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  cachedReplay,
  previewCaption,
  previewFen,
  previewLastMove,
  previewShapes,
  type LinePreviewPrefs,
} from './linePreview'

/** Which line is pointed at and how far into it, with the line itself. */
export interface HoveredLine {
  /**
   * The row's own identity, stable while the engine rewrites its lines — and namespaced by
   * the panel that reports it (`live:2`, `run:2`). A bare `multipv` would not do: one page
   * shows two boxes of lines, both numbered from 1, and one preview serves both, so "line
   * 2" has to say whose or the two would dim each other's tokens.
   */
  line: string
  /** 1-based ply within the line, or null for "the row, no particular move". */
  ply: number | null
  pv: string[]
}

export interface LinePreviewView {
  /** The transient position to show instead of the board's, or null to keep the real one. */
  fen: string | null
  lastMove: [string, string] | null
  shapes: DrawShape[]
  /** `after 10.O-O-O`, for the label over a scrubbed board. */
  caption: string | null
  /** Which line the preview stands on, and how far into it — handed back to the panel. */
  line: string | null
  ply: number | null
  /** Overlay's "dim the current pieces". */
  dim: boolean
  /** One ply along the previewed line: the panel's wheel. */
  step: (delta: number) => void
}

/** A ply that belongs to one line in one position, and to nothing else. */
interface KeyedPly {
  key: string
  ply: number
}

/** One array for every empty preview, so a board that draws nothing redraws nothing. */
const NO_SHAPES: DrawShape[] = []

const EMPTY = {
  fen: null,
  lastMove: null,
  shapes: NO_SHAPES,
  caption: null,
  line: null,
  ply: null,
  dim: false,
} as const

export function useLinePreview(
  fen: string | null,
  hover: HoveredLine | null,
  prefs: LinePreviewPrefs,
  startPly: number,
): LinePreviewView {
  const line = hover?.line ?? null
  // "This line, in this position." A preview belongs to the position it was read in and to
  // the moves it was read from, so all three go into the key: the hover moving to another
  // row, the reader leaving the position, and the engine rewriting the line are one event
  // as far as anything held here is concerned.
  const key = fen !== null && hover !== null ? `${fen}|${hover.line}|${hover.pv.join(' ')}` : null

  const [wheeled, setWheeled] = useState<KeyedPly | null>(null)
  const [playing, setPlaying] = useState<KeyedPly | null>(null)

  // Kept rather than cleared: a ply whose key no longer matches simply does not count, which
  // is the same thing one render earlier — an effect would leave a frame of the old line
  // scrubbed onto the new one.
  const wheeledPly = wheeled !== null && wheeled.key === key ? wheeled.ply : null
  const playingPly = playing !== null && playing.key === key ? playing.ply : null
  const at = wheeledPly ?? hover?.ply ?? playingPly ?? null

  // `cachedReplay` hands back the same object for the same position and line, so this is
  // stable across renders even though `hover` is not, and the memos below can stand on it.
  const replay = fen !== null && hover !== null ? cachedReplay(fen, hover.pv) : null
  const total = replay?.moves.length ?? 0

  // The playthrough runs only for a row nobody is pointing into: a token names its own ply,
  // and a wheel has taken the line over.
  const plays =
    prefs.row === 'play' &&
    key !== null &&
    total > 0 &&
    (hover?.ply ?? null) === null &&
    wheeledPly === null
  const { tempo, delay, loop } = prefs.play

  useEffect(() => {
    // Whatever the last run reached, it is not where this one starts — including where the
    // run has just been called off, so the board is not left standing mid-line.
    setPlaying(null)
    if (!plays || key === null) return
    let handle = 0
    let ply = 0
    const tick = () => {
      ply += 1
      setPlaying({ key, ply })
      if (ply < total) handle = window.setTimeout(tick, tempo)
      // The end of the line: stop on it, or hold it a moment and play the line again.
      else if (loop) handle = window.setTimeout(start, tempo * 2)
    }
    const start = () => {
      ply = 0
      setPlaying({ key, ply })
      handle = window.setTimeout(tick, tempo)
    }
    // The delay is what makes the mode survive a pointer crossing the panel on its way
    // somewhere else: a hover that does not last it never moves anything.
    handle = window.setTimeout(start, delay)
    return () => window.clearTimeout(handle)
  }, [plays, key, total, tempo, delay, loop])

  // The wheel arrives from a listener bound once, which therefore holds whatever `step` was
  // when it was bound; the ply it steps from lives behind a ref so that `step` never changes.
  const current = useRef({ key, at, total })
  useEffect(() => {
    current.current = { key, at, total }
  })

  const step = useCallback((delta: number) => {
    const { key: id, at: from, total: end } = current.current
    if (id === null || end === 0) return
    setWheeled({ key: id, ply: Math.min(end, Math.max(0, (from ?? 0) + delta)) })
  }, [])

  return useMemo(() => {
    if (replay === null || line === null) return { ...EMPTY, step }
    const state = { line, ply: at }
    return {
      fen: previewFen(replay, prefs, state),
      lastMove: previewLastMove(replay, prefs, state),
      shapes: previewShapes(replay, prefs, state, startPly),
      caption: previewCaption(replay, prefs, state, startPly),
      line,
      ply: at,
      // The ghosts are the point of the overlay and the pieces standing in the way are not
      // — but only while the whole line is drawn. On a ply the board is showing a real
      // position again, and dimming it would say something false about it.
      dim: prefs.row === 'overlay' && prefs.overlay.dim && at === null,
      step,
    }
  }, [replay, prefs, line, at, startPly, step])
}
