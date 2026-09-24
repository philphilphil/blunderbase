import { lazy } from 'react'

export const AnalysisPage = lazy(() =>
  import('@/routes/analysis').then((route) => ({ default: route.AnalysisPage })),
)
export const EnginePassesPage = lazy(() =>
  import('@/routes/analysis').then((route) => ({ default: route.EnginePassesPage })),
)
export const MaiaSettingsPage = lazy(() =>
  import('@/routes/analysis').then((route) => ({ default: route.MaiaSettingsPage })),
)
export const CorrespondenceSettingsPage = lazy(() =>
  import('@/routes/analysis').then((route) => ({ default: route.CorrespondenceSettingsPage })),
)
export const CorrespondencePage = lazy(() =>
  import('@/routes/correspondence').then((route) => ({ default: route.CorrespondencePage })),
)
export const CorrespondenceGamePage = lazy(() =>
  import('@/routes/correspondence').then((route) => ({ default: route.CorrespondenceGamePage })),
)
export const DashboardPage = lazy(() =>
  import('@/routes/dashboard').then((route) => ({ default: route.DashboardPage })),
)
export const EnginesPage = lazy(() =>
  import('@/routes/engines').then((route) => ({ default: route.EnginesPage })),
)
export const MachinesPage = lazy(() =>
  import('@/routes/engines').then((route) => ({ default: route.MachinesPage })),
)
export const ExplorerPage = lazy(() =>
  import('@/routes/explorer').then((route) => ({ default: route.ExplorerPage })),
)
export const GamePage = lazy(() =>
  import('@/routes/game').then((route) => ({ default: route.GamePage })),
)
export const GamesPage = lazy(() =>
  import('@/routes/games').then((route) => ({ default: route.GamesPage })),
)
export const ImportPage = lazy(() =>
  import('@/routes/import').then((route) => ({ default: route.ImportPage })),
)
export const LibraryManagePage = lazy(() =>
  import('@/routes/import').then((route) => ({ default: route.LibraryManagePage })),
)
export const LivePage = lazy(() =>
  import('@/routes/live').then((route) => ({ default: route.LivePage })),
)
export const McpPage = lazy(() =>
  import('@/routes/mcp').then((route) => ({ default: route.McpPage })),
)
export const ReferenceGamePage = lazy(() =>
  import('@/routes/reference').then((route) => ({ default: route.ReferenceGamePage })),
)
export const RepertoirePage = lazy(() =>
  import('@/routes/repertoire').then((route) => ({ default: route.RepertoirePage })),
)
export const NotesPage = lazy(() =>
  import('@/routes/notes').then((route) => ({ default: route.NotesPage })),
)
export const StatsPage = lazy(() =>
  import('@/routes/stats').then((route) => ({ default: route.StatsPage })),
)

/**
 * The chunk a destination needs, by the first segment of its path — the same `import()`
 * specifiers as above, which is what makes Vite hand back the same chunk rather than a
 * second copy of it.
 *
 * A screen split into its own chunk is fetched the first time it is opened, and the reader
 * sees the shell's "Loading…" in the meantime. Pointing at a rail entry is a second or so
 * of warning that a screen is about to be asked for, which is longer than the fetch takes;
 * `preloadRoute` spends it, so the screen is already here by the time it is clicked.
 */
const CHUNKS: Record<string, () => Promise<unknown>> = {
  '': () => import('@/routes/dashboard'),
  games: () => import('@/routes/games'),
  explorer: () => import('@/routes/explorer'),
  repertoire: () => import('@/routes/repertoire'),
  reference: () => import('@/routes/reference'),
  notes: () => import('@/routes/notes'),
  stats: () => import('@/routes/stats'),
  library: () => import('@/routes/import'),
  import: () => import('@/routes/import'),
  analysis: () => import('@/routes/analysis'),
  compute: () => import('@/routes/engines'),
  engines: () => import('@/routes/engines'),
  assistant: () => import('@/routes/mcp'),
  board: () => import('@/routes/live'),
  correspondence: () => import('@/routes/correspondence'),
}

/** Fetch the chunk behind `path` now, so opening it later costs nothing. Safe to repeat. */
export function preloadRoute(path: string): void {
  const [first, second] = path.replace(/^\//, '').split(/[/?#]/)
  // `/games` is the library and `/games/7` is a game — two screens, two chunks.
  const load = first === 'games' && second ? () => import('@/routes/game') : CHUNKS[first ?? '']
  // A chunk that fails to fetch fails again, and says so, when the route is actually opened.
  load?.().catch(() => {})
}
