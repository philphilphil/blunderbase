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

/**
 * Sizes that are deliberately not on the scale, each with its reason. Add one only for
 * something that is not text in the scale's sense; a label, a cell or a heading that wants
 * a size in between wants a named one (docs/design/README.md, "Type scale").
 */
const OFF_SCALE: Record<string, string> = {
  // The captured-piece figurines are icons drawn with Unicode glyphs; they read by
  // silhouette and need the size to be told apart.
  '/src/routes/game/components/BoardPanel.tsx: text-[1.0625rem]': 'figurine icons',
  // The stats display numerals. The scale has no display size; these two are the only
  // numbers set larger than `text-value`, and they match each other.
  '/src/routes/stats/kit/states.tsx: text-[1.375rem]': 'StatTile KPI numeral',
  '/src/routes/stats/cards/ProgressCard.tsx: text-[1.375rem]': 'the one-month numeral',
}

describe('the type scale', () => {
  const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', eager: true }) as Record<
    string,
    { default: string }
  >
  const sources = Object.entries(files).filter(
    // This file names the patterns; utils.ts names the stock sizes in its doc comment.
    ([path]) => !path.endsWith('/lib/ui/scale.test.ts') && !path.endsWith('/lib/utils.ts'),
  )

  it('sets no font size by hand, only the six named sizes', () => {
    const found = new Set<string>()
    for (const [path, module] of sources) {
      for (const size of module.default.match(/\btext-\[\d[\d.]*(?:rem|em|px)\]/g) ?? []) {
        found.add(`${path}: ${size}`)
      }
    }
    expect([...found].filter((entry) => !(entry in OFF_SCALE))).toEqual([])
    // And an exception that is gone is taken off the list, so the list stays the truth.
    expect(Object.keys(OFF_SCALE).filter((entry) => !found.has(entry))).toEqual([])
  })

  it("uses none of Tailwind's stock sizes, which sit beside the scale rather than on it", () => {
    const offenders: string[] = []
    for (const [path, module] of sources) {
      for (const size of module.default.match(/(?<![\w-])text-(?:xs|sm|base|lg|[2-9]?xl)(?![\w/-])/g) ??
        []) {
        offenders.push(`${path}: ${size}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
