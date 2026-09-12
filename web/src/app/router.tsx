import { Trans, useLingui } from '@lingui/react/macro'
import type { ReactNode } from 'react'
import { createBrowserRouter, Link, Navigate } from 'react-router-dom'

import { AppShell } from '@/components/shell/AppShell'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { SETTING_DEFAULTS } from '@/lib/api/appSettings'
import { useAppSettings } from '@/lib/api/queries'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'

import {
  AnalysisPage,
  CorrespondenceGamePage,
  CorrespondencePage,
  CorrespondenceSettingsPage,
  DashboardPage,
  EnginePassesPage,
  EnginesPage,
  ExplorerPage,
  GamePage,
  GamesPage,
  ImportPage,
  LibraryManagePage,
  LivePage,
  MachinesPage,
  MaiaSettingsPage,
  McpPage,
  NotesPage,
  ReferenceGamePage,
  RepertoirePage,
  StatsPage,
} from './lazyRoutes'

function NotFound() {
  const { t } = useLingui()
  return (
    <PageBody>
      <PageHeader title={t`Not found`} description={t`That route does not exist.`} />
      <Link to="/" className="text-xs">
        <Trans>Back to the dashboard</Trans>
      </Link>
    </PageBody>
  )
}

function McpRoute({ children }: { children: ReactNode }) {
  return useRuntimeCapabilities().mcp ? <>{children}</> : <Navigate to="/" replace />
}

/**
 * Correspondence mode is off by default, and while it is off its screens do not exist —
 * the same shape as `McpRoute` above, with the deployment's own setting in place of a
 * runtime capability.
 *
 * The redirect waits for the settings to land rather than bouncing on a `undefined`:
 * arriving at `/correspondence/7` from a bookmark would otherwise be a trip to the
 * dashboard for everyone, mode on or off. The API itself is not gated — a deployment that
 * has switched the mode off must still be able to read the games it holds.
 */
function CorrespondenceRoute({ children }: { children: ReactNode }) {
  const settings = useAppSettings()
  if (!settings.data) return null
  const on = (settings.data.correspondence_enabled ?? SETTING_DEFAULTS.correspondence_enabled) === 1
  return on ? <>{children}</> : <Navigate to="/" replace />
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
      { path: 'analysis/correspondence', element: <CorrespondenceSettingsPage /> },
      // Compute is a heading like the two above: Engines is what is installed, Machines
      // is where it runs and how much at once. The old `/engines` keeps working.
      { path: 'compute', element: <Navigate to="/compute/engines" replace /> },
      { path: 'compute/engines', element: <EnginesPage /> },
      { path: 'compute/machines', element: <MachinesPage /> },
      { path: 'engines', element: <Navigate to="/compute/engines" replace /> },
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
      {
        path: 'correspondence',
        element: (
          <CorrespondenceRoute>
            <CorrespondencePage />
          </CorrespondenceRoute>
        ),
      },
      {
        path: 'correspondence/:id',
        element: (
          <CorrespondenceRoute>
            <CorrespondenceGamePage />
          </CorrespondenceRoute>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
