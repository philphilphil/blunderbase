import type { ReactNode } from 'react'
import { createBrowserRouter, Link, Navigate } from 'react-router-dom'

import { AppShell } from '@/components/shell/AppShell'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'

import {
  AnalysisPage,
  DashboardPage,
  EnginePassesPage,
  EnginesPage,
  ExplorerPage,
  GamePage,
  GamesPage,
  HelpPage,
  ImportPage,
  LibraryManagePage,
  LivePage,
  MaiaSettingsPage,
  McpPage,
  NotesPage,
  ReferenceGamePage,
  RepertoirePage,
  StatsPage,
} from './lazyRoutes'

function NotFound() {
  return (
    <PageBody>
      <PageHeader title="Not found" description="That route does not exist." />
      <Link to="/" className="text-xs">
        Back to the dashboard
      </Link>
    </PageBody>
  )
}

function McpRoute({ children }: { children: ReactNode }) {
  return useRuntimeCapabilities().mcp ? <>{children}</> : <Navigate to="/" replace />
}

/**
 * Every route in one place. Screens live in their own directory under `src/routes/` and
 * are re-exported from an `index.ts`, so a page can be rebuilt without this file or the
 * shell changing.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'games', element: <GamesPage /> },
      { path: 'games/:id', element: <GamePage /> },
      { path: 'explorer', element: <ExplorerPage /> },
      { path: 'repertoire', element: <RepertoirePage /> },
      // A leaf, not a destination: it is reached from the explorer's model-game list, so
      // it is deliberately absent from the rail and the command palette.
      { path: 'reference/:source/:gameId', element: <ReferenceGamePage /> },
      { path: 'notes', element: <NotesPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'library', element: <Navigate to="/library/import" replace /> },
      { path: 'library/import', element: <ImportPage /> },
      { path: 'library/manage', element: <LibraryManagePage /> },
      { path: 'import', element: <Navigate to="/library/import" replace /> },
      // Like `library` above: the section is a heading in the rail and every page under it
      // has a row of its own, so the parent is a redirect rather than a fourth destination
      // that only the word "Analysis" reaches.
      { path: 'analysis', element: <Navigate to="/analysis/coverage" replace /> },
      { path: 'analysis/coverage', element: <AnalysisPage /> },
      { path: 'analysis/engine', element: <EnginePassesPage /> },
      { path: 'analysis/maia', element: <MaiaSettingsPage /> },
      { path: 'engines', element: <EnginesPage /> },
      // `/mcp` is the server itself, so the human-facing setup page uses `/assistant`.
      {
        path: 'assistant',
        element: (
          <McpRoute>
            <McpPage />
          </McpRoute>
        ),
      },
      { path: 'live', element: <LivePage /> },
      { path: 'help', element: <HelpPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
