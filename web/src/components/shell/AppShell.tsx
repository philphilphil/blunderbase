import { Outlet } from 'react-router-dom'

import { useBackfillRun } from '@/lib/analysis'

import { BackfillTakeover } from './BackfillTakeover'
import { CommandPaletteProvider } from './CommandPalette'
import { SideNav } from './SideNav'
import { TopBar } from './TopBar'

/**
 * Layout 1a "Studio": a 46px titlebar over a 200px rail and the page's own canvas.
 * Every route renders inside the `<Outlet />`, so a page never has to know about the
 * chrome — it fills the titlebar through `<SetPageChrome>` instead.
 *
 * The ⌘K palette wraps the lot rather than sitting in the titlebar: the shortcut is
 * global, and the dialog has to outlive whichever route is under it.
 *
 * A whole-library analysis pass replaces all of it — see `BackfillTakeover`. The route
 * stays in the URL underneath, so releasing puts the owner back on the page they left.
 */
export function AppShell() {
  const backfill = useBackfillRun()
  if (backfill) return <BackfillTakeover run={backfill} />

  return (
    <CommandPaletteProvider>
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <SideNav />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  )
}
