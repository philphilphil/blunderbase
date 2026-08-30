import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'

import { browserRunner } from '@/lib/runner'
import { NativeFeedback } from '@/lib/desktop/NativeFeedback'
import { PgnDropOverlay } from '@/lib/desktop/PgnDropOverlay'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'

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
 */
export function AppShell() {
  const capabilities = useRuntimeCapabilities()
  // If a browser runner is installed in this browser, this is where it comes back: the
  // shell is what a signed-in tab mounts, and the link has to be alive on every page rather
  // than only while somebody is looking at `/engines`. A no-op when nothing is installed,
  // and safe to call again — the client ignores a resume it is already connected for.
  useEffect(() => {
    if (capabilities.remote_runners) browserRunner.resume()
    else browserRunner.stop()
  }, [capabilities.remote_runners])

  const [navOpen, setNavOpen] = useState(false)
  const main = useRef<HTMLElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const closeNav = useCallback(() => setNavOpen(false), [])
  const openNav = useCallback(() => setNavOpen(true), [])

  // A route change starts at the page rather than wherever focus happened to be in the
  // previous screen. The main landmark remains visible because it takes no custom outline.
  useEffect(() => {
    const frame = requestAnimationFrame(() => main.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [location.pathname])

  useEffect(() => {
    const routes: Record<string, string> = {
      '1': '/',
      '2': '/games',
      '3': '/explorer',
      '4': '/notes',
      '5': '/stats',
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const route = event.shiftKey && event.key.toLowerCase() === 'i' ? '/import' : routes[event.key]
      if (!route) return
      event.preventDefault()
      navigate(route)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  return (
    <CommandPaletteProvider>
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-[80] -translate-y-16 rounded-md bg-accent-teal px-3 py-2 text-xs font-semibold text-accent-ink transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <div className="flex h-full min-h-0 flex-col bg-surface">
        <TopBar onOpenNav={openNav} />
        <div className="flex min-h-0 flex-1">
          <SideNav />
          <main
            ref={main}
            id="main-content"
            tabIndex={-1}
            className="flex min-w-0 flex-1 flex-col overflow-hidden outline-none"
          >
            <Suspense
              fallback={
                <div
                  role="status"
                  className="flex flex-1 items-center justify-center text-xs text-dim"
                >
                  Loading…
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
      <NavDrawer open={navOpen} onClose={closeNav} />
      <PgnDropOverlay />
      <NativeFeedback />
      <Toaster
        position="bottom-right"
        gap={8}
        toastOptions={{ unstyled: true, classNames: TOAST_CLASSES }}
      />
    </CommandPaletteProvider>
  )
}
