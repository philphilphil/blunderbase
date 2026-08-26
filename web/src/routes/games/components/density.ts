/**
 * The S / M / L row heights behind design 2b's density control ("rows 34px").
 *
 * `height` is `rem` so a row grows with the app's scale like everything else; `px` is the
 * design-file figure the control reads out, which is what the design labels the sizes by.
 */
export type Density = 'S' | 'M' | 'L'

export const DENSITIES: Record<Density, { label: string; height: string; px: number }> = {
  S: { label: 'S', height: '2.125rem', px: 34 },
  M: { label: 'M', height: '2.5rem', px: 40 },
  L: { label: 'L', height: '3rem', px: 48 },
}

export const DEFAULT_DENSITY: Density = 'S'
