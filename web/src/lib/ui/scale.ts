/**
 * The app's global scale.
 *
 * Everything the browser lays out is expressed in `rem`/`em` or a Tailwind scale utility,
 * so `html { font-size: 120% }` in `index.css` is the only knob: at 100 % browser zoom the
 * UI renders at what used to be 120 % (docs/design/README.md, "120 % as the base scale").
 *
 * Recharts is the one place that does not go through CSS. Its axis widths, tick margins and
 * chart margins are plain numbers in SVG user units, so they cannot be `rem` — `scalePx`
 * carries them at the same factor, and `rem` gives the charts' type the same treatment as
 * every other size in the app. `scale.test.ts` pins `ROOT_SCALE` to what `index.css` says.
 */

/** Must equal the `html { font-size }` percentage in `index.css`, expressed as a factor. */
export const ROOT_SCALE = 1.2

/** A design-file pixel as a root-relative length: `rem(11)` -> `'0.6875rem'`. */
export function rem(px: number): string {
  return `${px / 16}rem`
}

/** A design-file pixel as a rendered pixel, for APIs that only accept a number. */
export function scalePx(px: number): number {
  return Math.round(px * ROOT_SCALE * 100) / 100
}

/** `scalePx` over a Recharts `margin` object, which is four of the same. */
export function scaleMargin<T extends Record<string, number>>(margin: T): T {
  return Object.fromEntries(
    Object.entries(margin).map(([side, value]) => [side, scalePx(value)]),
  ) as T
}
