import { useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'

import { useBackfillRun } from '@/lib/analysis'
import { browserRunner } from '@/lib/runner'

import { BackfillTakeover } from './BackfillTakeover'
import { CommandPaletteProvider } from './CommandPalette'
import { NavDrawer, SideNav } from './SideNav'
import { TopBar } from './TopBar'

/**
 * `sonner`'s own styles are switched off (`unstyled`) and every slot rebuilt from the
 * app's semantic classes, so a toast reads as part of Blunderbase in both themes rather
 * than as a widget from somewhere else — the same reason nothing in this app names a hex.
 */
const TOAST_CLASSES = {
  toast:
    'flex items-center gap-2.5 rounded-xl border border-edge-strong bg-elevated px-3.5 py-3 text-[0.78125rem] text-ink shadow-[0_0.5rem_1.5rem_var(--bb-shadow)]',
  title: 'text-ink',
  description: 'text-dim',
  icon: 'flex-none',
  actionButton: 'rounded-md bg-accent-teal px-2 py-1 text-accent-ink',
  cancelButton: 'rounded-md bg-raised px-2 py-1 text-dim',
  closeButton: 'border-edge bg-elevated text-dim hover:text-ink',
  success: 'border-good/30',
  error: 'border-blunder/30',
  info: 'border-info/30',
}

/**
 * Layout 1a "Studio": a 46px titlebar over a 200px rail and the page's own canvas.
 * Every route renders inside the `<Outlet />`, so a page never has to know about the
 * chrome — it fills the titlebar through `<SetPageChrome>` instead.
 *
 * The ⌘K palette wraps the lot rather than sitting in the titlebar: the shortcut is
 * global, and the dialog has to outlive whichever route is under it.
 *
 * Below `md` the rail has nowhere to stand, so it becomes a drawer over the page. Whether
 * it is up is the shell's state and not the titlebar's: the button that opens it is in the
 * titlebar but the drawer itself covers everything, and the two would otherwise have to
 * reach across the layout for each other.
 *
 * A whole-library analysis pass replaces all of it — see `BackfillTakeover`. The route
 * stays in the URL underneath, so releasing puts the owner back on the page they left.
 */
export function AppShell() {
  // If a browser runner is installed in this browser, this is where it comes back: the
  // shell is what a signed-in tab mounts, and the link has to be alive on every page rather
  // than only while somebody is looking at `/engines`. A no-op when nothing is installed,
  // and safe to call again — the client ignores a resume it is already connected for.
  useEffect(() => {
    browserRunner.resume()
  }, [])

  const [navOpen, setNavOpen] = useState(false)
  const closeNav = useCallback(() => setNavOpen(false), [])
  const openNav = useCallback(() => setNavOpen(true), [])

  const backfill = useBackfillRun()
  if (backfill) return <BackfillTakeover run={backfill} />

  return (
    <CommandPaletteProvider>
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <TopBar onOpenNav={openNav} />
        <div className="flex min-h-0 flex-1">
          <SideNav />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
      <NavDrawer open={navOpen} onClose={closeNav} />
      <Toaster
        position="bottom-right"
        gap={8}
        toastOptions={{ unstyled: true, classNames: TOAST_CLASSES }}
      />
    </CommandPaletteProvider>
  )
}
