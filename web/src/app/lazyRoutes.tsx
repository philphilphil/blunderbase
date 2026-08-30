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
export const DashboardPage = lazy(() =>
  import('@/routes/dashboard').then((route) => ({ default: route.DashboardPage })),
)
export const EnginesPage = lazy(() =>
  import('@/routes/engines').then((route) => ({ default: route.EnginesPage })),
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
export const HelpPage = lazy(() =>
  import('@/routes/help').then((route) => ({ default: route.HelpPage })),
)
export const ImportPage = lazy(() =>
  import('@/routes/import').then((route) => ({ default: route.ImportPage })),
)
export const LivePage = lazy(() =>
  import('@/routes/live').then((route) => ({ default: route.LivePage })),
)
export const McpPage = lazy(() =>
  import('@/routes/mcp').then((route) => ({ default: route.McpPage })),
)
export const NotesPage = lazy(() =>
  import('@/routes/notes').then((route) => ({ default: route.NotesPage })),
)
export const StatsPage = lazy(() =>
  import('@/routes/stats').then((route) => ({ default: route.StatsPage })),
)
