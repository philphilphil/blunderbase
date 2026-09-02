/**
 * The 200px workspace rail from the design, and the drawer it becomes on a phone.
 *
 * Three parts, on every frame: the workspace list (with the Games count), the data list,
 * and a pinned footer with the engine roster above it.
 *
 * An entry with more inside it unfolds when you are in it, and only then — Saved filters
 * under Games, Your lines under Openings, Reports under Stats, the configuration pages
 * under Analysis. They used to be one section at the bottom of the rail that swapped
 * contents with the screen, which meant the list of cuts of the library sat under a
 * heading of its own three entries away from Games, and nothing said whose they were.
 *
 * The rail folds to an icon strip and back from a control in that footer; the choice is
 * remembered per browser. See `SideNav`.
 *
 * Below `md` there is no room for a rail beside the page, so the same list slides in over
 * it from the titlebar's hamburger — see `NavDrawer`. The two share `NavSections` rather
 * than each keeping their own copy of the nav model: a second copy is a second place to
 * forget a route.
 */
import {
  ChartNoAxesColumn,
  Cpu,
  Database,
  Gauge,
  LayoutDashboard,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Network,
  StickyNote,
  X,
} from 'lucide-react'
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { StatusDot } from '@/components/badges/StatusDot'
import { useEngines, useGames, useLiveState } from '@/lib/api/queries'
import type { Color } from '@/lib/api/types'
import { useEvents } from '@/lib/events/EventsProvider'
import { paramsFromFilters, toGameQuery } from '@/routes/games/filters'
import {
  removeSavedFilter,
  useSavedFilters,
  type SavedFilter,
} from '@/routes/games/savedFilters'
import { REPORTS, reportFrom } from '@/routes/stats/reports'
import { cn } from '@/lib/utils'
import { VERSION_LABEL } from '@/lib/version'

import { LINE_SAMPLE, scoreTone, topLines } from './openingLines'
import { ThemeToggle } from './ThemeToggle'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
}

const WORKSPACE: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/games', label: 'Games', icon: Library },
  { to: '/explorer', label: 'Explorer', icon: Network },
  // The repertoire page (`/repertoire`) is routed but not listed: its base version is in
  // the code and still needs work before it is offered (issue #4). When it returns it goes
  // here, next to Openings and not under it — the explorer says what the owner *has*
  // played and the repertoire what they *mean* to play, a destination of its own rather
  // than a cut of the explorer's tree.
  { to: '/stats', label: 'Stats', icon: ChartNoAxesColumn },
  { to: '/notes', label: 'Notes', icon: StickyNote },
  { to: '/live', label: 'Live', icon: Radio },
]

/**
 * The data itself, what has been run over it, and what runs it — in that order.
 */
const DATA: NavItem[] = [
  { to: '/library', label: 'Library', icon: Database },
  { to: '/analysis', label: 'Analysis', icon: Gauge },
  { to: '/engines', label: 'Engines', icon: Cpu },
]

/**
 * The pages that live under a rail entry, and only appear once that entry is open.
 *
 * A submenu pinned open is two more rows to read on every screen the owner is not
 * configuring anything on; one that unfolds on entering the section says "these belong to
 * Analysis" by where it sits, and costs nothing everywhere else.
 *
 * Every page under an entry is listed, including the one the entry itself used to be: both
 * `/library` and `/analysis` redirect to their first subpage (`app/router.tsx`), so the
 * parent is a heading and each page has a row of its own. An entry that is both a heading
 * and a destination made "Analysis" mean two different things depending on whether you
 * clicked the word or the row under it.
 */
const SUBPAGES: Record<string, { to: string; label: string }[]> = {
  '/library': [
    { to: '/library/import', label: 'Import' },
    { to: '/library/manage', label: 'Manage' },
  ],
  '/analysis': [
    { to: '/analysis/coverage', label: 'Coverage' },
    { to: '/analysis/engine', label: 'Engine passes' },
    { to: '/analysis/maia', label: 'Maia' },
  ],
}

/** Whether a rail entry's own route, or one of its pages, is what is on screen. */
function inSection(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

const ROWS = 4

/** Where the folded/unfolded choice lives, so it survives a reload and a route change. */
const COLLAPSED_KEY = 'blunderbase.navCollapsed'

/**
 * Whether the rail is folded to icons.
 *
 * Context rather than a prop threaded through six components: every row, label and fold in
 * here has to know, and the drawer — which is never folded, because a drawer that is only
 * icons is a worse drawer — has to be able to say so for its whole subtree at once.
 */
const Collapsed = createContext(false)
const useCollapsed = () => useContext(Collapsed)

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * A group heading. Folded, the words have nowhere to go, so the grouping is said with a
 * rule instead — losing the heading entirely would run the two lists together.
 */
function SectionLabel({ children }: { children: ReactNode }) {
  if (useCollapsed()) return <div className="mx-2 my-1.5 h-px bg-hairline" />
  return (
    <div className="px-2 pt-1.5 pb-2 text-[0.625rem] tracking-[0.12em] text-faint uppercase">
      {children}
    </div>
  )
}

/** The quiet label over a fold's contents — "Filters", "Your lines · black", "Reports". */
function FoldLabel({ children }: { children: ReactNode }) {
  return <div className="px-1.5 py-1 text-[0.625rem] text-faint">{children}</div>
}

function Item({
  item,
  trailing,
  trailingClass,
}: {
  item: NavItem
  trailing?: string
  trailingClass?: string
}) {
  const Icon = item.icon
  const collapsed = useCollapsed()
  return (
    <NavLink
      to={item.to}
      end={item.end}
      // Folded, the icon is the whole row, so the name it would have read has to be said
      // some other way or the link has no accessible name at all.
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          // The selected row is a filled row and nothing else. It used to carry an accent
          // bar down its left edge as well, which made every rail on screen argue with the
          // fill about which one was saying "you are here".
          'flex items-center gap-2.5 rounded-md py-[0.4375rem] text-[0.8125rem] transition-colors',
          collapsed ? 'justify-center px-0' : 'px-2',
          isActive ? 'bg-selected text-ink' : 'text-soft hover:bg-raised hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={cn('size-3.5 flex-none', isActive ? 'text-body-3' : 'text-faint')} />
          {collapsed ? null : item.label}
          {trailing && !collapsed ? (
            <>
              <span className="flex-1" />
              <span className={cn('font-mono text-[0.6875rem] tabular text-dim', trailingClass)}>
                {trailing}
              </span>
            </>
          ) : null}
        </>
      )}
    </NavLink>
  )
}

/**
 * The pages of the open entry.
 *
 * Smaller and dimmer than the entry above them, and without its accent bar, so the rail
 * still reads as one list of destinations with one of them opened rather than as two
 * levels competing for the eye.
 */
function SubPages({ pages }: { pages: { to: string; label: string }[] }) {
  return (
    <>
      {pages.map((page) => (
        <NavLink
          key={page.to}
          to={page.to}
          className={({ isActive }) =>
            cn(
              'rounded-md px-1.5 py-[0.375rem] text-[0.75rem] transition-colors',
              isActive ? 'bg-selected text-ink' : 'text-dim hover:bg-raised hover:text-ink',
            )
          }
        >
          {page.label}
        </NavLink>
      ))}
    </>
  )
}

/** A row of the second section: a coloured dot, a label, and a mono figure on the right. */
function DotRow({
  to,
  active,
  dotClass,
  children,
  trailing,
  trailingClass,
  title,
  leading,
}: {
  to: string
  active?: boolean
  dotClass?: string
  children: ReactNode
  trailing?: ReactNode
  trailingClass?: string
  title?: string
  /** Set before the label — the ECO code in "Your lines". */
  leading?: ReactNode
}) {
  return (
    <NavLink
      to={to}
      title={title}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-1.5 py-[0.375rem] text-[0.75rem] transition-colors',
        active ? 'bg-selected text-ink' : 'text-soft hover:bg-raised hover:text-ink',
      )}
    >
      {dotClass ? <span className={cn('size-1.5 flex-none rounded-full', dotClass)} /> : null}
      {leading}
      <span className="truncate">{children}</span>
      {trailing !== undefined ? (
        <>
          <span className="flex-1" />
          <span className={cn('font-mono text-[0.625rem] tabular text-dim', trailingClass)}>
            {trailing}
          </span>
        </>
      ) : null}
    </NavLink>
  )
}

function EngineRoster() {
  const engines = useEngines()
  return (
    <>
      <SectionLabel>Engines</SectionLabel>
      {(engines.data ?? []).slice(0, 6).map((engine) => (
        <div
          key={engine.id}
          className="flex items-center gap-2.5 rounded-md px-2 py-[0.4375rem] text-[0.8125rem] text-soft"
          title={engine.path}
        >
          <StatusDot tone={engine.enabled ? 'healthy' : 'away'} className="mx-1" />
          <span className="truncate">{engine.name}</span>
        </div>
      ))}
      {engines.data?.length === 0 ? (
        <div className="px-2 py-[0.4375rem] text-[0.75rem] text-faint">No engines configured</div>
      ) : null}
    </>
  )
}

/**
 * Design 2b's "Saved filters": the cuts of the library worth one click. Three built-ins
 * plus whatever the filter row's "Save filter" has put there — see `routes/games/
 * savedFilters.ts` for where they live.
 */
function SavedFilterRow({
  id,
  label,
  filters,
  dotClass,
  builtin,
  search,
}: SavedFilter & { search: string }) {
  const params = paramsFromFilters(filters)
  const count = useGames({ ...toGameQuery(filters), limit: 1 })
  const current = new URLSearchParams(search)
  // Active only when the library is showing exactly this cut and nothing else.
  const active =
    [...params].every(([key, value]) => current.get(key) === value) &&
    [...current.keys()].length === [...params.keys()].length

  return (
    <div className="group/saved relative">
      <DotRow
        to={`/games?${params.toString()}`}
        active={active}
        dotClass={dotClass}
        trailing={count.data === undefined ? '' : count.data.total.toLocaleString()}
      >
        {label}
      </DotRow>
      {builtin ? null : (
        <button
          type="button"
          aria-label={`Forget the saved filter “${label}”`}
          title="Forget this filter"
          onClick={() => removeSavedFilter(id)}
          className="absolute inset-y-0 right-0 hidden items-center bg-raised px-1 text-faint hover:text-blunder group-hover/saved:flex"
        >
          ×
        </button>
      )}
    </div>
  )
}

function SavedFilters({ search }: { search: string }) {
  const filters = useSavedFilters()
  return (
    <>
      {/* Named, the way "Your lines" and "Reports" are: without it the cuts read as more
          destinations under Games rather than as one list of ways to slice the one below. */}
      <FoldLabel>Filters</FoldLabel>
      {filters.map((filter) => (
        <SavedFilterRow key={filter.id} {...filter} search={search} />
      ))}
      {filters.length === 0 ? (
        <div className="px-2 py-[0.4375rem] text-[0.75rem] text-faint">No saved filters yet</div>
      ) : null}
    </>
  )
}

/** Design 2c's "Your lines · black": the ECO codes the scoped games keep reaching. */
function YourLines({ search }: { search: string }) {
  const scope = (new URLSearchParams(search).get('color') as Color | null) ?? undefined
  const games = useGames({ limit: LINE_SAMPLE, ...(scope ? { color: scope } : {}) })
  const lines = topLines(games.data?.games, ROWS)

  return (
    <>
      <FoldLabel>{`Your lines · ${scope ?? 'both colours'}`}</FoldLabel>
      {lines.map((line) => (
        <DotRow
          key={line.eco}
          to={`/games?eco=${line.eco}${scope ? `&color=${scope}` : ''}`}
          title={`${line.name} — ${line.games} of your last ${LINE_SAMPLE} games`}
          leading={<span className="font-mono text-[0.625rem] text-dim">{line.eco}</span>}
          trailing={`${Math.round(line.score)}%`}
          trailingClass={scoreTone(line.score)}
        >
          {line.name}
        </DotRow>
      ))}
      {games.isPending || lines.length > 0 ? null : (
        <div className="px-2 py-[0.4375rem] text-[0.75rem] text-faint">No openings on record yet</div>
      )}
    </>
  )
}

/** Design 2d's "Reports": which aggregation the stats screen is showing. */
function Reports({ search }: { search: string }) {
  const current = reportFrom(search)
  return (
    <>
      {REPORTS.map((report) => (
        <DotRow
          key={report.key}
          to={`/stats?report=${report.key}`}
          active={report.key === current}
          title={report.hint}
        >
          {report.label}
        </DotRow>
      ))}
    </>
  )
}

const REPO = 'https://github.com/philphilphil/blunderbase'

/**
 * The GitHub mark, drawn here rather than imported: lucide-react 1.x dropped its brand
 * icons, so this is lucide's own `github` glyph inlined in the same stroke idiom the rest
 * of the rail uses — it takes `size-*` and `currentColor` like any other icon.
 */
function Github({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

/** Whether `/events` is carrying anything — a dot, because a word would crowd the row. */
function ConnectionDot() {
  const { status, reconnects } = useEvents()
  const label =
    status === 'open'
      ? `live${reconnects > 0 ? ` · reconnected ${reconnects}×` : ''}`
      : status === 'connecting'
        ? 'connecting to /events'
        : 'offline — retrying'
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'size-[0.375rem] rounded-full',
        status === 'open'
          ? 'bg-accent-teal'
          : status === 'connecting'
            ? 'bg-mistake'
            : 'bg-blunder',
      )}
    />
  )
}

/**
 * The pinned footer: the window's bottom edge, where a desktop app keeps its odds and ends
 * — the fold control, the source link, the live-connection dot and the build's version, and
 * below `md` the theme control, which is the titlebar's from `md` up and comes back here
 * because that is what the phone's drawer carries.
 *
 * It used to lead with an "engine coverage" bar. That is gone: Analysis answers the same
 * question properly and at length (`/analysis/coverage`), the bar cost two `useGames`
 * queries on every screen in the app to say it badly, and a progress bar pinned under the
 * navigation reads as the app doing something rather than as a statistic.
 *
 * Folded, everything made of words drops and the fold control is centred on its own: the
 * one thing that must stay reachable is the way back out.
 */
function NavFooter({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const fold = (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand the navigation' : 'Collapse the navigation'}
      className="flex items-center rounded-md px-0.5 py-1 text-dim transition-colors hover:bg-raised hover:text-ink"
    >
      {collapsed ? (
        <PanelLeftOpen className="size-3.5" aria-hidden />
      ) : (
        <PanelLeftClose className="size-3.5" aria-hidden />
      )}
    </button>
  )

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5 border-t border-hairline px-1 pt-2 pb-1">
        {fold}
        <ConnectionDot />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[0.3125rem] border-t border-hairline px-2 pt-2 pb-1">
      <div className="flex items-center gap-2">
        {fold}
        {/*
          The toolbar carries the theme control at `md` and up (`TopBar`); this copy is the
          phone's, reached through the drawer, where the titlebar has no room for it.
        */}
        <ThemeToggle className="md:hidden" />
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          aria-label="Blunderbase on GitHub"
          title="Blunderbase on GitHub"
          className="flex items-center px-0.5 text-dim transition-colors hover:text-ink"
        >
          <Github className="size-3.5" />
        </a>
        <span className="flex-1" />
        <ConnectionDot />
        <a
          href={`${REPO}/blob/main/CHANGELOG.md`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[0.625rem] text-dim-2 transition-colors hover:text-ink"
          title={`Blunderbase ${VERSION_LABEL} — what changed`}
        >
          {VERSION_LABEL}
        </a>
      </div>
    </div>
  )
}

/**
 * What unfolds under the open entry: its pages, or the list that belongs to the screen it
 * is showing — the same indent and hairline either way, so a fold is one shape.
 *
 * Games opens on the library itself and not on one game: a saved cut is a jump within the
 * list, which is not a question anyone is asking while looking at a board.
 */
function Folded({ to, pathname, search }: { to: string; pathname: string; search: string }) {
  // Folded to icons there is no room for a second level, and no label to hang it under.
  if (useCollapsed()) return null
  const pages = SUBPAGES[to]
  const body = pages ? (
    <SubPages pages={pages} />
  ) : to === '/games' ? (
    pathname === '/games' ? <SavedFilters search={search} /> : null
  ) : to === '/explorer' ? (
    <YourLines search={search} />
  ) : to === '/stats' ? (
    <Reports search={search} />
  ) : null

  if (!body) return null
  return (
    <div className="ml-3 flex flex-col border-l border-hairline pl-1">{body}</div>
  )
}

/**
 * Everything the rail holds, without the frame around it: the same fragment fills the
 * desktop rail and the phone drawer, so a route added here appears in both. Both wrappers
 * are flex columns, which is what the `flex-1` spacer above the roster needs to push the
 * footer to the bottom.
 */
function NavSections({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { pathname, search } = useLocation()
  const games = useGames({ limit: 1 })
  const live = useLiveState()

  const total = games.data?.total
  const liveActive = live.data?.active === true

  const entry = (item: NavItem, trailing?: string) => (
    <Fragment key={item.to}>
      <Item item={item} trailing={trailing} />
      {inSection(pathname, item.to) ? (
        <Folded to={item.to} pathname={pathname} search={search} />
      ) : null}
    </Fragment>
  )

  return (
    <>
      <SectionLabel>Workspace</SectionLabel>
      {WORKSPACE.map((item) =>
        entry(
          item,
          item.to === '/games' && total !== undefined
            ? total.toLocaleString()
            : item.to === '/live' && liveActive
              ? 'on air'
              : undefined,
        ),
      )}

      <div className="h-3.5" />
      <SectionLabel>Data &amp; compute</SectionLabel>
      {DATA.map((item) => entry(item))}

      <div className="flex-1" />
      {/* Names and status dots, so it goes with everything else made of words. */}
      {collapsed ? null : <EngineRoster />}
      <NavFooter collapsed={collapsed} onToggle={onToggle} />
    </>
  )
}

/**
 * The rail, and the fold it remembers.
 *
 * Folded it is an icon strip: every destination keeps a row and a tooltip, and everything
 * that is words — the group headings, the counts, the open entry's second level, the engine
 * roster — stands down until it comes back. That is a narrower rail rather than no rail,
 * because a rail that vanishes has to put the way back somewhere else, and there is nowhere
 * on this window that is not already spoken for.
 *
 * The choice is this component's rather than the shell's: nothing above it needs to know,
 * the page beside it is a flex sibling that simply takes the width back, and `localStorage`
 * is what carries it across a reload.
 */
export function SideNav() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = useCallback(() => {
    setCollapsed((was) => {
      const next = !was
      try {
        window.localStorage.setItem(COLLAPSED_KEY, String(next))
      } catch {
        // Private mode: the fold simply does not survive a reload.
      }
      return next
    })
  }, [])

  return (
    <Collapsed.Provider value={collapsed}>
      <nav
        aria-label="Sections"
        className={cn(
          'flex flex-none flex-col gap-px border-r border-edge-strong bg-panel py-2.5 max-md:hidden',
          collapsed ? 'w-[3.25rem] px-1.5' : 'w-50 px-2',
        )}
      >
        <NavSections collapsed={collapsed} onToggle={toggle} />
      </nav>
    </Collapsed.Provider>
  )
}

/**
 * The rail on a phone: the same list, over the page instead of beside it.
 *
 * Only in the tree while it is open, so nothing below `md` pays for a second copy of the
 * nav's queries and no test finds two of every link. `md:hidden` is the belt to that
 * brace — a window widened while the drawer is up gets the rail back and nothing on top of
 * it, without a resize listener.
 *
 * Three ways out, because a drawer that traps you is worse than no drawer: the backdrop,
 * Escape, and following any link in it. The last watches the location rather than the
 * anchors, so the folded lists (saved filters, reports, your lines) close it too.
 */
export function NavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname, search } = useLocation()
  const here = `${pathname}${search}`
  const wasHere = useRef(here)
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    if (wasHere.current === here) return
    wasHere.current = here
    if (open) onClose()
  }, [here, open, onClose])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  // Moving focus into the panel is what makes Escape and tabbing land here rather than
  // back in the titlebar behind the backdrop.
  useEffect(() => {
    if (open) panel.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        aria-hidden
        data-testid="nav-backdrop"
        onClick={onClose}
        className="absolute inset-0 animate-in bg-void/70 duration-200 fade-in-0"
      />
      <nav
        ref={panel}
        tabIndex={-1}
        aria-label="Sections"
        className="relative flex h-full w-[17rem] max-w-[85vw] flex-col gap-px overflow-y-auto border-r border-edge-strong bg-panel shadow-[0_0_2rem_var(--bb-shadow)] outline-none duration-200 animate-in slide-in-from-left pt-[max(0.875rem,env(safe-area-inset-top,0rem))] pr-2.5 pb-[max(0.875rem,env(safe-area-inset-bottom,0rem))] pl-[max(0.625rem,env(safe-area-inset-left,0rem))]"
      >
        <div className="flex flex-none items-center justify-between pb-1">
          <span className="pl-2 text-[0.8125rem] font-semibold tracking-[-0.01em] text-ink">
            Blunderbase
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the navigation"
            className="rounded-md p-1 text-dim transition-colors hover:bg-raised hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
        <NavSections collapsed={false} onToggle={() => {}} />
      </nav>
    </div>
  )
}
