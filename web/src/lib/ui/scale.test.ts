import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { rem, ROOT_SCALE, scaleMargin, scalePx } from './scale'

/**
 * Straight off disk: vitest blanks CSS imports (`css: false`) and Vite rewrites
 * `new URL(…, import.meta.url)` into an asset URL, so neither route reaches the source.
 * Vitest runs with `web/` as its working directory.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('rem', () => {
  it('turns a design-file pixel into a root-relative length', () => {
    expect(rem(16)).toBe('1rem')
    expect(rem(11)).toBe('0.6875rem')
    expect(rem(9.5)).toBe('0.59375rem')
  })
})

describe('scalePx', () => {
  it('carries a number-only length at the root scale', () => {
    expect(scalePx(10)).toBe(12)
    expect(scalePx(44)).toBe(52.8)
  })

  it('scales every side of a chart margin', () => {
    expect(scaleMargin({ top: 5, right: 0, bottom: 0, left: -10 })).toEqual({
      top: 6,
      right: 0,
      bottom: 0,
      left: -12,
    })
  })
})

describe('the global scale', () => {
  // `scalePx` exists only to keep Recharts' number-only geometry in step with the CSS
  // scale; if the stylesheet moves and this constant does not, charts desync silently.
  it('matches the html font-size in index.css', () => {
    const css = read('src/index.css')
    const match = css.match(/html\s*\{\s*font-size:\s*([\d.]+)%/)
    expect(match, 'index.css should set html { font-size: <n>% }').not.toBeNull()
    expect(Number(match![1]) / 100).toBe(ROOT_SCALE)
  })

  it('leaves no unscalable px length in a Tailwind arbitrary value', () => {
    const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', eager: true }) as Record<
      string,
      { default: string }
    >
    const offenders: string[] = []
    for (const [path, module] of Object.entries(files)) {
      for (const value of module.default.match(/\[[^\][\s"'`]*\]/g) ?? []) {
        if (/\d(?:\.\d+)?px/.test(value)) offenders.push(`${path}: ${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the three-column game view at 1440', () => {
  /**
   * Design 1a has to survive the scale-up without a horizontal scrollbar: the rail plus the
   * two column floors plus their dividers must fit the 1440 the owner works at. Parsed
   * out of the source rather than restated, so a widened column fails here rather than in
   * the browser.
   */
  it('fits the rail and two column floors inside 1440', () => {
    const page = read('src/routes/game/GamePage.tsx')
    const nav = read('src/components/shell/SideNav.tsx')

    const railUnits = Number(nav.match(/<nav className="flex w-(\d+)/)![1]) / 4 // w-50 -> 12.5rem
    // The board column is the one that grows, the move table the one that is sized.
    const boardFloor = Number(page.match(/min-w-\[([\d.]+)rem\] flex-1/)![1])
    const movesFloor = Number(page.match(/min-w-\[([\d.]+)rem\] grow-0/)![1])

    const px = (units: number) => units * 16 * ROOT_SCALE
    const dividers = 2 // one hairline between each pair of columns
    const total = px(railUnits + boardFloor + movesFloor) + dividers

    expect(total).toBeLessThanOrEqual(1440)
    // …and the floors are still no narrower on screen than the design's 420 / 280.
    expect(px(boardFloor)).toBeGreaterThanOrEqual(420)
    expect(px(movesFloor)).toBeGreaterThanOrEqual(280)
  })
})
