import { Outlet } from 'react-router-dom'

import { SideNav } from './SideNav'
import { TopBar } from './TopBar'

/**
 * Layout 1a "Studio": a 46px titlebar over a 200px rail and the page's own canvas.
 * Every route renders inside the `<Outlet />`, so a page never has to know about the
 * chrome — it fills the titlebar through `<SetPageChrome>` instead.
 */
export function AppShell() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
