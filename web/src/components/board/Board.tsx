import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Config } from '@lichess-org/chessground/config'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Color as CgColor, Key } from '@lichess-org/chessground/types'
import { useEffect, useMemo, useRef, type ReactNode, type Ref } from 'react'

import { cn } from '@/lib/utils'

import { BOARD_BRUSHES } from './brushes'

export type Square = Key
export type BoardOrientation = CgColor
export type CoordinateMode = 'edge' | 'inside' | 'none'

/** An arrow, as both the live session and the engine/Maia overlays describe one. */
export interface BoardArrow {
  from: string
  to: string
  /** A brush name from `BOARD_BRUSHES`. Defaults to the teal engine brush. */
  color?: string
  /**
   * Mark this arrow as also being the move that was played — how one arrow says two things
   * at once. The board draws one arrow per *move*, so when the move an engine recommends is
   * also the move the game played there is nothing to draw twice, and this is what stops
   * that economy from losing the second fact.
   *
   * A chalk `P` chip at the shaft's junction with the arrowhead. One letter rather than the
   * word: a legible "played" is most of a square wide, which on a board of ~100px squares
   * covers the piece the arrow is pointing at. The chip is in the played colour as well, so
   * it says the same thing twice — by hue, the way the three arrows are told apart, and by
   * the letter for anyone who has not learnt the hue yet. The settings dialog names all
   * three.
   */
  played?: boolean
}

/** A square marked with a colour (the coach's highlights) or a custom CSS class. */
export interface BoardSquare {
  square: string
  /** A brush name — drawn as a chessground circle. */
  color?: string
  /**
   * A class from `index.css` instead: `bb-blunder`, `bb-mistake`, `bb-inaccuracy` — the
   * classification outlines. Takes precedence over `color`.
   */
  className?: string
}

export interface BoardProps {
  fen: string
  orientation?: BoardOrientation
  /** `"e2e4"`, `["e2", "e4"]`, or nothing. A promotion suffix is ignored. */
  lastMove?: string | [string, string] | null
  arrows?: BoardArrow[]
  squares?: BoardSquare[]
  /** Raw chessground shapes, for anything the two props above cannot express. */
  shapes?: DrawShape[]
  turnColor?: BoardOrientation
  check?: BoardOrientation | boolean
  /**
   * `'edge'` (design 1a) draws a rank column left of the board and a file row under it;
   * `'inside'` (design 1b) uses chessground's in-square coordinates. `true` is `'edge'`,
   * because 1a is the layout the app is built on (`docs/design/README.md`).
   */
  coordinates?: boolean | CoordinateMode
  viewOnly?: boolean
  /**
   * Let the reader draw their own arrows and circles with the right mouse button, the way
   * every chess site does. Off everywhere by default; chessground also suppresses the
   * board's context menu when it is on, which is what makes the gesture usable at all.
   */
  drawable?: boolean
  animation?: boolean
  animationDuration?: number
  onMove?: (orig: Square, dest: Square) => void
  onSelect?: (square: Square) => void
  className?: string
  /** Overlays drawn on top of the squares — the Maia card, a coach's banner. */
  children?: ReactNode
  ref?: Ref<Api | null>
}

const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
/** Geist Mono 10px in `--bb-dim-2`, the way design 1a sets the edge coordinates. */
const COORD = 'font-mono text-[0.625rem] text-dim-2 select-none'

const SQUARE = /^[a-h][1-8]$/

function isSquare(value: string): value is Square {
  return SQUARE.test(value)
}

/** `"e7e8q"` -> `["e7", "e8"]`; anything unparseable is dropped rather than thrown. */
export function parseLastMove(
  lastMove: string | [string, string] | null | undefined,
): Key[] | undefined {
  if (!lastMove) return undefined
  const pair = Array.isArray(lastMove) ? lastMove : [lastMove.slice(0, 2), lastMove.slice(2, 4)]
  const [from, to] = pair
  if (!from || !to || !isSquare(from) || !isSquare(to)) return undefined
  return [from, to]
}

/**
 * The played-move mark: a chalk chip with a `P` in it, at the shaft's junction with the
 * arrowhead.
 *
 * Drawn in the 100-unit box chessground gives a `customSvg` — one box is one square — at
 * `r=13`, so the chip is about a quarter of a square across against the `r=20` chessground
 * sets its own move glyphs at. Small on purpose: this is a footnote on an arrow, not a
 * label on the square, and anything bigger sits on top of the piece the arrow is pointing
 * at — which is what killed the pill this replaced. `r` and `font-size` are two separate
 * literals: move one and the other has to follow, and `y` is the text *baseline*, which
 * wants to stay near `50 + font-size × 0.36` to keep the capital centred in the disc.
 *
 * Chessground's own `label` would be the obvious way to draw this and cannot be: it
 * hardcodes `white` for both the text and the ring, which on a chalk fill is invisible in
 * the dark theme. Ours takes both colours from tokens that invert together — chalk chip,
 * the app's own ground for the letter and the ring — so the contrast holds either way up.
 */
const PLAYED_MARK =
  // 0.6 is not a taste number: it is the opacity chessground's own stylesheet puts on
  // `.cg-shapes`, the layer every arrow and circle is drawn in. Custom SVGs live in
  // `.cg-custom-svgs`, which has no such rule — so without this the chip rendered at full
  // strength beside arrows at 0.57, and read as a badge stuck on top of the board rather
  // than as part of the arrow it belongs to. Applied to the group, so the disc, its ring
  // and the letter fade together and their contrast with each other is untouched.
  '<g opacity="0.6">' +
  '<circle cx="50" cy="50" r="13" fill="var(--bb-arrow-played)"' +
  ' stroke="var(--bb-void)" stroke-width="2" stroke-opacity="0.6" />' +
  '<text x="50" y="56.5" text-anchor="middle" font-size="18" font-weight="600"' +
  ' font-family="ui-sans-serif, system-ui, sans-serif" fill="var(--bb-void)">P</text>' +
  '</g>'

function toShapes(
  arrows: BoardArrow[] | undefined,
  squares: BoardSquare[] | undefined,
): DrawShape[] {
  const shapes: DrawShape[] = []
  for (const arrow of arrows ?? []) {
    if (!isSquare(arrow.from) || !isSquare(arrow.to)) continue
    const brush = arrow.color ?? 'accent'
    const shape: DrawShape = { orig: arrow.from, dest: arrow.to, brush }
    if (arrow.played) shape.customSvg = { html: PLAYED_MARK, center: 'label' }
    shapes.push(shape)
  }
  for (const square of squares ?? []) {
    if (square.className) continue // rendered through highlight.custom instead
    if (!isSquare(square.square)) continue
    shapes.push({ orig: square.square, brush: square.color ?? 'yellow' })
  }
  return shapes
}

function publish(ref: Ref<Api | null> | undefined, value: Api | null): void {
  if (!ref) return
  if (typeof ref === 'function') ref(value)
  else ref.current = value
}

function toCustomHighlights(squares: BoardSquare[] | undefined): Map<Key, string> {
  const custom = new Map<Key, string>()
  for (const square of squares ?? []) {
    if (!square.className || !isSquare(square.square)) continue
    custom.set(square.square, square.className)
  }
  return custom
}

/**
 * chessground, as a controlled React component.
 *
 * The board is created once and then reconfigured: chessground animates between two
 * `set()` calls, which is what makes a coach-driven move on `/live` slide rather than
 * jump. Every prop is applied on every render, so the component is a pure function of
 * its props even though the DOM underneath it is imperative.
 */
export function Board({
  fen,
  orientation = 'white',
  lastMove,
  arrows,
  squares,
  shapes,
  turnColor,
  check,
  coordinates = true,
  viewOnly = true,
  drawable = false,
  animation = true,
  animationDuration = 200,
  onMove,
  onSelect,
  className,
  children,
  ref,
}: BoardProps) {
  const mode: CoordinateMode =
    coordinates === true ? 'edge' : coordinates === false ? 'none' : coordinates
  const inside = mode === 'inside'
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<Api | null>(null)
  // chessground binds its callbacks once, so the current handlers live behind a ref.
  const handlers = useRef({ onMove, onSelect })
  useEffect(() => {
    handlers.current = { onMove, onSelect }
  })

  const drawn = useMemo(
    () => (shapes ? [...toShapes(arrows, squares), ...shapes] : toShapes(arrows, squares)),
    [arrows, squares, shapes],
  )
  const custom = useMemo(() => toCustomHighlights(squares), [squares])

  // Created once and then reconfigured, so animation state survives. `viewOnly`,
  // `coordinates` and `drawable` are the three chessground only reads at creation, so
  // changing any of them rebuilds the board: the first two it writes into the wrapper
  // element itself and cannot be reconfigured (see `Api.set`), and `drawable.enabled` is
  // read by `bindBoard`, which binds the board's `contextmenu` listener once and never
  // looks again. Note what chessground requires of the third: `bindBoard` returns before
  // it binds any pointer handler when `viewOnly` is set, so drawing is dead on a view-only
  // board and `drawable` only means anything on one that is not.
  useEffect(() => {
    if (!host.current) return
    const config: Config = {
      viewOnly,
      // Edge coordinates are drawn by this component, outside the squares.
      coordinates: inside,
      // The position is part of the *creation* config, not left to the effect below:
      // chessground would otherwise paint the initial array first and then animate all 32
      // pieces into place on the first `set()`, which a board that mounts mid-game (a deep
      // link into the explorer, `/live`, a rebuild because `viewOnly` changed) would show
      // every single time.
      fen,
      orientation,
      lastMove: parseLastMove(lastMove),
      highlight: { lastMove: true, check: true, custom },
      ...(turnColor ? { turnColor } : {}),
      ...(check === undefined ? {} : { check }),
      drawable: { enabled: drawable, visible: true, brushes: BOARD_BRUSHES },
      movable: {
        free: false,
        events: { after: (orig, dest) => handlers.current.onMove?.(orig, dest) },
      },
      events: { select: (key) => handlers.current.onSelect?.(key) },
    }
    const instance = Chessground(host.current, config)
    api.current = instance
    // The handle is published here rather than through `useImperativeHandle`, which runs
    // before this effect and would hand the caller a null board.
    publish(ref, instance)
    return () => {
      instance.destroy()
      api.current = null
      publish(ref, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewOnly, inside, drawable])

  useEffect(() => {
    const instance = api.current
    if (!instance) return
    // chessground's `configure` deep-merges and does assign `undefined`, so a key that
    // has no value is left out rather than passed through as one.
    const next: Config = {
      fen,
      orientation,
      lastMove: parseLastMove(lastMove),
      animation: { enabled: animation, duration: animationDuration },
      highlight: { lastMove: true, check: true, custom },
      movable: { free: false, color: onMove ? (turnColor ?? 'both') : undefined },
    }
    if (turnColor) next.turnColor = turnColor
    if (check !== undefined) next.check = check
    instance.set(next)
    instance.setAutoShapes(drawn)
  }, [
    fen,
    orientation,
    lastMove,
    turnColor,
    check,
    inside,
    viewOnly,
    drawable,
    animation,
    animationDuration,
    custom,
    drawn,
    onMove,
  ])

  const square = (
    <div
      className={cn(
        'relative aspect-square min-w-0 select-none',
        mode === 'edge' ? 'col-start-2 row-start-1' : cn('w-full', className),
      )}
    >
      <div ref={host} data-testid="board" className="cg-wrap absolute inset-0 h-full w-full" />
      {children}
    </div>
  )

  if (mode !== 'edge') return square

  // Design 1a: a 14px rank column left of the board and a file row under it. Laid out as a
  // grid so the file row sits under the squares alone rather than under the rail as well.
  const ranks = orientation === 'white' ? [...RANKS].reverse() : [...RANKS]
  const files = orientation === 'white' ? [...FILES] : [...FILES].reverse()
  return (
    <div
      className={cn(
        'grid grid-cols-[0.875rem_minmax(0,1fr)] grid-rows-[auto_auto] gap-1.5',
        className,
      )}
    >
      <div
        aria-hidden
        className={cn('col-start-1 row-start-1 flex flex-col items-center justify-around', COORD)}
      >
        {ranks.map((rank) => (
          <span key={rank}>{rank}</span>
        ))}
      </div>
      {square}
      <div aria-hidden className={cn('col-start-2 row-start-2 flex justify-around', COORD)}>
        {files.map((file) => (
          <span key={file}>{file}</span>
        ))}
      </div>
    </div>
  )
}
