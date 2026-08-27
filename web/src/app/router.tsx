import { createBrowserRouter, Link } from 'react-router-dom'

import { AppShell } from '@/components/shell/AppShell'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { DashboardPage } from '@/routes/dashboard'
import { EnginesPage } from '@/routes/engines'
import { ExplorerPage } from '@/routes/explorer'
import { GamePage } from '@/routes/game'
import { GamesPage } from '@/routes/games'
import { ImportPage } from '@/routes/import'
import { LivePage } from '@/routes/live'
import { SettingsPage } from '@/routes/settings'
import { StatsPage } from '@/routes/stats'

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
      { path: 'stats', element: <StatsPage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'settings/engines', element: <EnginesPage /> },
      { path: 'live', element: <LivePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
