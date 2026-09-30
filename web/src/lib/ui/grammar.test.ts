import { describe, expect, it } from 'vitest'

/**
 * The control grammar's guards (the clarity pass, docs/design/README.md "Controls"): the
 * patterns that bring back a control the grammar retired, checked in every source file the
 * way `scale.test.ts` checks the type scale. Every screen has moved over, so there is no
 * list of files let off: any offender fails.
 */

type Guard =
  | 'variant="outline"'
  | 'hover:bg-selected'
  | 'focus-visible:bg-raised'
  | 'disabled:pointer-events-none'
  | 'hand-copied link'
  | 'hand-built radio or tab'
  | 'focus-visible:ring-'
  | 'badge border'

const GUARDS: Record<Guard, { pattern: RegExp; exempt?: (path: string) => boolean; why: string }> =
  {
    'variant="outline"': {
      pattern: /variant=["']outline["']|variant:\s*['"]outline['"]/,
      why: '`outline` is retired: a command is `secondary`',
    },
    'hover:bg-selected': {
      // Bare only: `aria-pressed:hover:bg-selected` keeps an on thing on under the pointer.
      pattern: /(?<![\w:\]-])hover:bg-selected\b/,
      exempt: (path) => path.startsWith('components/ui/'),
      why: 'hover must not preview "selected"; hover is `bg-raised`',
    },
    'focus-visible:bg-raised': {
      pattern: /focus-visible:bg-raised\b/,
      why: 'focus is the ring, never a fill',
    },
    'disabled:pointer-events-none': {
      pattern: /disabled:pointer-events-none/,
      why: 'a disabled control keeps its title and a not-allowed cursor',
    },
    'hand-copied link': {
      pattern: /text-accent-teal hover:text-accent-link/,
      exempt: (path) => path === 'components/ui/text-link.tsx',
      why: 'a link is a `TextLink`',
    },
    'hand-built radio or tab': {
      pattern: /role=["'](?:radio|radiogroup|tab)["']/,
      exempt: (path) =>
        path.startsWith('components/ui/') || path === 'routes/game/components/PaneTabList.tsx',
      why: 'one-of-N is a `Segmented`, a pane tab a `PaneTab`',
    },
    'focus-visible:ring-': {
      pattern: /focus-visible:ring-/,
      why: 'one focus ring, the global outline',
    },
    'badge border': {
      pattern: /['"`][^'"`\n]*(?<![\w-])(?:[\w-]+:)*border(?:-[^\s'"`]+)?(?![\w-])[^'"`\n]*['"`]/,
      exempt: (path) => path !== 'components/ui/badge.tsx',
      why: 'a readout has no border',
    },
  }

/** Comments name the patterns they explain; only code is checked. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the control grammar', () => {
  const files = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', eager: true }) as Record<
    string,
    { default: string }
  >
  const sources = Object.entries(files)
    .filter(([path]) => !/\.test\.tsx?$/.test(path))
    .map(([path, module]) => [path.replace(/^\/src\//, ''), stripComments(module.default)] as const)

  for (const [guard, { pattern, exempt, why }] of Object.entries(GUARDS) as [
    Guard,
    (typeof GUARDS)[Guard],
  ][]) {
    it(`has no new ${guard} (${why})`, () => {
      const offenders = sources
        .filter(([path, source]) => !exempt?.(path) && pattern.test(source))
        .map(([path]) => path)
      expect(offenders).toEqual([])
    })
  }

  // The patterns are only worth as much as their aim: each must catch what it is named for.
  it('catches what each guard is named for', () => {
    expect(GUARDS['variant="outline"'].pattern.test('<Button variant="outline">')).toBe(true)
    expect(GUARDS['hover:bg-selected'].pattern.test("'hover:bg-selected'")).toBe(true)
    expect(GUARDS['hover:bg-selected'].pattern.test("'aria-pressed:hover:bg-selected'")).toBe(false)
    expect(GUARDS['hand-built radio or tab'].pattern.test('role="tab"')).toBe(true)
    expect(GUARDS['hand-built radio or tab'].pattern.test('role="tablist"')).toBe(false)
    expect(GUARDS['badge border'].pattern.test("default: 'border-edge bg-elevated'")).toBe(true)
    expect(GUARDS['badge border'].pattern.test("default: 'bg-chip-neutral text-dim'")).toBe(false)
  })
})
