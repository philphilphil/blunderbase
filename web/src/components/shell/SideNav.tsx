/**
 * The 200px rail, which carries the app (the clarity pass, decision D3-A), and the drawer it
 * becomes on a phone.
 *
 * Top to bottom, full height: the brand row (42px, its rule continuing the bar's, with the
 * demo tint and the fold control), a search field, the destinations, and a foot of two
 * short rows: the engine line, and Settings with the live dot. Only the middle, from
 * search to the foot, ever scrolls; the brand row and the foot stay put, and at 1440×900
 * with any one fold open nothing scrolls at all (spec §2.2, "Fit").
 *
 * "You are here" is one mark on one row: the leaf (the deepest place that is current) gets
 * the `nav-current` pill and accent text, its parent stays plain ink, and nothing lights on
 * hover. The old rail filled the parent and the leaf alike, and hover filled a third row,
 * so three rows could say "here" at once; blue fill is never location (spec §4).
 *
 * An entry with more inside it unfolds when you are in it, and only then — Filters under
 * Games, Your lines under Explorer, Reports under Stats, the pages under Library, Analysis
 * and Compute. They used to be one section at the bottom of the rail that swapped contents
 * with the screen, which meant the list of cuts of the library sat under a heading of its
 * own three entries away from Games, and nothing said whose they were. Pinned collections
 * are the exception: always shown under Collections, since they are places you return to
 * rather than the contents of the page you are on.
 *
 * The rail folds to an icon strip and back from a control at the end of its brand row; the
 * choice is remembered per browser. See `SideNav` and `BrandRow`.
 *
 * Below `md` there is no room for a rail beside the page, so the same rail slides in over
 * it from the titlebar's ☰ — see `NavDrawer`. The two share `RailBody` rather than each
 * keeping their own copy of the nav model: a second copy is a second place to forget a route.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import {
  ArrowUpRight,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
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
import { Link, useLocation } from 'react-router-dom'

import { preloadRoute } from '@/app/lazyRoutes'
import { StatusDot } from '@/components/badges/StatusDot'
import { Button } from '@/components/ui/button'
import {
  AnalysisIcon,
  CollectionsIcon,
  ComputeIcon,
  CorrespondenceIcon,
  DashboardIcon,
  ExplorerIcon,
  GamesIcon,
  LibraryIcon,
  LiveIcon,
  NotesIcon,
  StatsIcon,
} from '@/components/icons/NavIcons'
import { SETTING_DEFAULTS } from '@/lib/api/appSettings'
import {
  useAppSettings,
  useCollections,
  useCorrespondenceGames,
  useCorrespondenceStatus,
  useEngines,
  useGames,
  useLiveState,
} from '@/lib/api/queries'
import type { Collection, Color } from '@/lib/api/types'
import { collectionColorClasses } from '@/lib/collections'
import { useEvents } from '@/lib/events/EventsProvider'
import { pinnedCollectionHref, useLibraryPlace } from '@/lib/libraryPlace'
import { SITE_URL } from '@/lib/links'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { paramsFromFilters, toGameQuery } from '@/routes/games/filters'
import { carrySort, showsCut } from '@/routes/games/libraryLinks'
import {
  filterLabel,
  removeSavedFilter,
  useSavedFilters,
  type SavedFilter,
} from '@/routes/games/savedFilters'
import { REPORTS, reportFrom, reportPath } from '@/routes/stats/reports'
import { cn } from '@/lib/utils'

import { SettingsMenu } from './SettingsMenu'
import { useCommandPalette } from './CommandPalette'
import { LINE_SAMPLE, scoreTone, topLines } from './openingLines'
import { pageKeyHint } from './pageKeys'

interface NavItem {
  to: string
  label: MessageDescriptor
  icon: ComponentType<{ className?: string }>
  end?: boolean
}

const WORKSPACE: NavItem[] = [
  { to: '/', label: msg`Dashboard`, icon: DashboardIcon, end: true },
  { to: '/games', label: msg`Games`, icon: GamesIcon },
  // Beside Games because it is the other way into the same games: Games is the whole
  // library, cut by any filter, and Collections the groups the owner keeps in it, seen
  // side by side. An entry of its own rather than a fold under Games, so the groups are
  // one click from anywhere and each can show its record, not just its name.
  { to: '/collections', label: msg`Collections`, icon: CollectionsIcon },
  { to: '/explorer', label: msg`Explorer`, icon: ExplorerIcon },
  // The repertoire page (`/repertoire`) is routed but not listed: its base version is in
  // the code and still needs work before it is offered (issue #4). When it returns it goes
  // here, next to Openings and not under it — the explorer says what the owner *has*
  // played and the repertoire what they *mean* to play, a destination of its own rather
  // than a cut of the explorer's tree.
  { to: '/stats', label: msg`Stats`, icon: StatsIcon },
  { to: '/notes', label: msg`Notes`, icon: NotesIcon },
  { to: '/live', label: msg`Live`, icon: LiveIcon },
]

/**
 * The entry that is only there for some deployments: correspondence mode, off by default
 * (`correspondence_enabled`). Kept out of `WORKSPACE` rather than filtered out of it, so
 * that the list every reader of this file sees is the list every install has, and the one
 * conditional entry says so by standing apart.
 */
const CORRESPONDENCE: NavItem = { to: '/correspondence', label: msg`Correspondence`, icon: CorrespondenceIcon }

/**
 * The data itself, what has been run over it, and what runs it — in that order.
 */
const DATA: NavItem[] = [
  { to: '/library', label: msg`Library`, icon: LibraryIcon },
  { to: '/analysis', label: msg`Analysis`, icon: AnalysisIcon },
  { to: '/compute', label: msg`Compute`, icon: ComputeIcon },
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
const SUBPAGES: Record<string, { to: string; label: MessageDescriptor }[]> = {
  '/library': [
    { to: '/library/import', label: msg`Import` },
    { to: '/library/manage', label: msg`Manage` },
  ],
  '/analysis': [
    { to: '/analysis/coverage', label: msg`Coverage` },
    { to: '/analysis/engine', label: msg`Engine passes` },
    { to: '/analysis/maia', label: msg`Maia` },
    { to: '/analysis/correspondence', label: msg`Correspondence` },
  ],
  '/compute': [
    { to: '/compute/engines', label: msg`Engines` },
    { to: '/compute/machines', label: msg`Machines` },
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
 * A group heading. There is one, over Data & compute: the first group needs none (it is the
 * app), and the old spaced-caps WORKSPACE / ENGINES headings made the rail read like a
 * settings page. Sentence case and semibold, so it reads as a label and not a destination.
 * Folded, the words have nowhere to go, so the grouping is said with a rule instead —
 * losing the heading entirely would run the two lists together.
 */
function SectionLabel({ children }: { children: ReactNode }) {
  if (useCollapsed()) return <div className="mx-2 my-1.5 h-px bg-hairline" />
  return <div className="px-2 pt-3 pb-1 text-label font-semibold text-dim">{children}</div>
}

/** The quiet label over a fold's contents — "Filters", "Your lines · black". */
function FoldLabel({ children }: { children: ReactNode }) {
  return <div className="px-1.5 py-1 text-meta text-dim-2">{children}</div>
}

/**
 * How a rail row is marked: `leaf` is the one "you are here" (the deepest current place),
 * `parent` the entry a lit leaf is folded under, `idle` everything else.
 */
type Mark = 'leaf' | 'parent' | 'idle'

/** The leaf's pill: a neutral step up from the panel, accent text. Never a blue fill. */
const LEAF = 'bg-nav-current font-medium text-accent-teal'
/** Idle rows are quiet and hover changes only the text: a hover fill was a second lit row. */
const IDLE = 'text-soft hover:text-ink'
/** Keyboard focus draws inside the row, since the rail clips what spills over its edge. */
const RING = 'focus-visible:outline-offset-[-0.125rem]'

function Item({
  item,
  mark,
  trailing,
  trailingClass,
}: {
  item: NavItem
  mark: Mark
  trailing?: string
  trailingClass?: string
}) {
  const Icon = item.icon
  const collapsed = useCollapsed()
  const { i18n } = useLingui()
  const label = i18n._(item.label)
  const key = pageKeyHint(item.to)
  // Folded to icons there is no leaf to show, so the entry it is under lights instead.
  const shown: Mark = collapsed && mark === 'parent' ? 'leaf' : mark
  // The screen's code is fetched while the pointer is still on its way to the click.
  const preload = () => preloadRoute(item.to)
  return (
    <Link
      to={item.to}
      onPointerEnter={preload}
      onFocus={preload}
      aria-current={shown === 'leaf' ? 'page' : undefined}
      // Folded, the icon is the whole row, so the name it would have read has to be said
      // some other way or the link has no accessible name at all.
      aria-label={collapsed ? label : undefined}
      // The row's shortcut, where it has one: the rail is where the numbers are learned.
      title={key ? `${label} ${key}` : collapsed ? label : undefined}
      className={cn(
        'group flex items-center gap-2.5 rounded-md py-[0.4375rem] text-lead transition-colors',
        RING,
        collapsed ? 'justify-center px-0' : 'px-2',
        shown === 'leaf' ? LEAF : shown === 'parent' ? 'text-ink' : IDLE,
      )}
    >
      <Icon
        className={cn(
          'size-3.5 flex-none transition-colors',
          shown === 'leaf'
            ? 'text-accent-teal'
            : shown === 'parent'
              ? 'text-body-3'
              : 'text-dim group-hover:text-body-3',
        )}
      />
      {collapsed ? null : label}
      {trailing && !collapsed ? (
        <>
          <span className="flex-1" />
          {/* A count stays a figure on the lit row: grey, regular weight. */}
          <span className={cn('font-mono text-label font-normal tabular text-dim', trailingClass)}>
            {trailing}
          </span>
        </>
      ) : null}
    </Link>
  )
}

/**
 * The pages of the open entry. Smaller than the entry above them and indented under its
 * rule, so the rail still reads as one list of destinations with one of them opened. The
 * current page is the leaf; the entry above it stays plain.
 */
function SubPages({
  pages,
  pathname,
}: {
  pages: { to: string; label: MessageDescriptor }[]
  pathname: string
}) {
  const { i18n } = useLingui()
  return (
    <>
      {pages.map((page) => {
        const here = inSection(pathname, page.to)
        return (
          <Link
            key={page.to}
            to={page.to}
            aria-current={here ? 'page' : undefined}
            className={cn(
              'rounded-md px-1.5 py-[0.375rem] text-data transition-colors',
              RING,
              here ? LEAF : IDLE,
            )}
          >
            {i18n._(page.label)}
          </Link>
        )
      })}
    </>
  )
}

/**
 * A row of a fold or of the pinned collections: an optional marker, a label, a mono figure
 * on the right.
 *
 * One metric for every such row: the marker sits in a fixed `size-2` slot, so the text of
 * a saved filter (a round dot, centred) and of a collection (its square swatch, filling the
 * slot) starts at the same x. The two shapes stay distinct on purpose, so a collection never
 * reads as a saved filter even in the same colour.
 */
function DotRow({
  to,
  lit = false,
  marker,
  markerClass,
  children,
  trailing,
  trailingClass,
  title,
  leading,
}: {
  to: string
  lit?: boolean
  marker?: 'dot' | 'swatch'
  markerClass?: string
  children: ReactNode
  trailing?: ReactNode
  trailingClass?: string
  title?: string
  /** Set before the label — the ECO code in "Your lines". */
  leading?: ReactNode
}) {
  return (
    <Link
      to={to}
      title={title}
      aria-current={lit ? 'page' : undefined}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-1.5 py-[0.375rem] text-data transition-colors',
        RING,
        lit ? LEAF : IDLE,
      )}
    >
      {marker ? (
        <span aria-hidden className="flex size-2 flex-none items-center justify-center">
          <span
            className={cn(
              marker === 'dot' ? 'size-1.5 rounded-full' : 'size-2 rounded-[0.125rem]',
              markerClass,
            )}
          />
        </span>
      ) : null}
      {leading}
      <span className="truncate">{children}</span>
      {trailing !== undefined ? (
        <>
          <span className="flex-1" />
          <span className={cn('font-mono text-meta font-normal tabular text-dim', trailingClass)}>
            {trailing}
          </span>
        </>
      ) : null}
    </Link>
  )
}

/** How many rows a route fold shows before the rest go behind `More (n) ›`. */
const FOLD_CAP = 4

interface FoldRow {
  key: string
  lit: boolean
  node: ReactNode
}

/**
 * A route fold's rows: at most `FOLD_CAP` rows in all, the last of them `More (n) ›` to the
 * page they belong to when there are more. A fold that grows with every saved filter pushed
 * Compute under the foot on a 900px window, and `More` counts as a row because it takes one
 * (measured: with five saved filters, four of them plus `More` was a row too many). The lit
 * row is never the one hidden, so the rail always shows where you are.
 */
function CappedRows({ rows, more }: { rows: FoldRow[]; more: string }) {
  const { t } = useLingui()
  const overflow = rows.length > FOLD_CAP
  const litIndex = rows.findIndex((row) => row.lit)
  const room = overflow ? FOLD_CAP - 1 : FOLD_CAP
  // A lit row past the room takes the last place, so the fold never grows for it.
  const head = litIndex >= room ? room - 1 : room
  const shown = rows.filter((row, index) => index < head || row.lit)
  const hidden = rows.length - shown.length
  return (
    <>
      {shown.map((row) => (
        <Fragment key={row.key}>{row.node}</Fragment>
      ))}
      {hidden > 0 ? (
        <Link
          to={more}
          className={cn(
            'flex items-center gap-0.5 rounded-md px-1.5 py-[0.375rem] text-data text-dim transition-colors hover:text-ink',
            RING,
          )}
        >
          {t`More (${hidden})`}
          <ChevronRight className="size-3 flex-none" aria-hidden />
        </Link>
      ) : null}
    </>
  )
}

/**
 * What the correspondence engines are doing, as one line under the engines: searches running
 * out of the slots there are, `1/2`. The rest of what the strip under the foot used to list —
 * parked processes, searches waiting, tasks, each remote host — is the line's tooltip: a
 * search runs for days and "are both slots taken" is the question asked from every screen,
 * the others are what you ask next and only then.
 *
 * Only while the mode is on (the caller mounts it then) and only while there is something to
 * say: an install with no search running gets its line back.
 */
function SearchSlots() {
  const { t } = useLingui()
  const status = useCorrespondenceStatus()
  const data = status.data
  if (!data) return null
  const remote = (data.hosts ?? []).filter((host) => host.runner_id !== null)
  const inUse = data.in_use ?? 0
  const slots = data.slots ?? 0
  // The warm processes, not the paused rows: a restart makes every paused search cold, and
  // `parked, warm` is a claim about memory this machine is actually holding.
  const parked = (data.parked ?? []).length
  const paused = data.paused ?? 0
  const queued = data.queued ?? 0
  // Beside the slots, never against them: a task is a run in the analysis queue and may be
  // working on another machine, so it takes nothing from the slots.
  const running = data.tasks?.running ?? 0
  const tasks = (data.tasks?.queued ?? 0) + running
  if (inUse === 0 && paused === 0 && queued === 0 && tasks === 0 && remote.length === 0) {
    return null
  }
  const lines = [
    t`Correspondence searches: ${inUse} of ${slots} slots`,
    ...(parked > 0 ? [t`parked, warm: ${parked}`] : []),
    ...(queued > 0 ? [t`waiting: ${queued}`] : []),
    ...(tasks > 0 ? [running > 0 ? t`tasks: ${running} of ${tasks} running` : t`tasks: ${tasks}`] : []),
    ...remote.map((host) => `${host.host}: ${host.in_use ?? 0} / ${host.slots}`),
  ]
  return (
    <div
      title={lines.join('\n')}
      aria-label={lines.join(', ')}
      className="flex min-w-0 items-center gap-1.5 px-1 py-[0.1875rem] text-label text-dim"
    >
      <StatusDot tone={inUse > 0 ? 'working' : 'waiting'} />
      <span className="min-w-0 flex-1 truncate">
        {/* Named for the mode, not "searches": down here, beside the engines, a bare
            "searches" could be anything the engines do. */}
        <Trans comment="Rail foot: correspondence searches running, beside in-use/slots">
          Correspondence
        </Trans>
      </span>
      <span className="flex-none font-mono text-meta tabular text-soft">
        {inUse}/{slots}
      </span>
    </div>
  )
}

/**
 * The engines, at the head of the foot: one line per engine, its status dot (green enabled,
 * grey disabled) and its name, each a way to Compute › Engines; in correspondence mode a
 * line for the searches under them (`SearchSlots`). One line per engine rather than the
 * names run together, which cut off after the second at 200px and left the rest to guess.
 * Not nav rows: they have no pill and never light, even on the Engines page, since they are
 * a status and the rail already marks where you are. Folded, one chip with the dot of the
 * whole set.
 */
function EnginesLine({ correspondence }: { correspondence: boolean }) {
  const engines = useEngines()
  const collapsed = useCollapsed()
  const { t } = useLingui()
  const list = engines.data ?? []
  const enabled = list.filter((engine) => engine.enabled)
  const none = engines.data !== undefined && list.length === 0
  const names = (enabled.length > 0 ? enabled : list).map((engine) => engine.name).join(', ')
  const dot =
    list.length === 0 ? (
      <span aria-hidden className="size-1.5 flex-none rounded-full border border-faint" />
    ) : (
      <StatusDot tone={enabled.length > 0 ? 'healthy' : 'away'} />
    )
  const title = none ? t`Compute › Engines: set one up` : t`${names} — Compute › Engines`
  // Folded, the chip with its dot on its corner: the same status, the same way in.
  if (collapsed) {
    return (
      <Link
        to="/compute/engines"
        aria-label={title}
        title={title}
        className={cn(
          'relative flex size-7 items-center justify-center rounded-md text-dim transition-colors hover:bg-raised hover:text-ink',
          RING,
        )}
      >
        <ComputeIcon className="size-3.5" />
        <span className="absolute top-1 right-1 flex">{dot}</span>
      </Link>
    )
  }
  const row = cn(
    'group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-[0.1875rem] text-label text-dim transition-colors hover:text-ink',
    RING,
  )
  return (
    <div className="flex min-w-0 flex-col">
      {/* Nothing while the list is on its way: a placeholder line would only jump. */}
      {none ? (
        <Link to="/compute/engines" title={title} className={row}>
          {dot}
          <span className="min-w-0 truncate underline-offset-2 group-hover:underline">
            {t`No engines`}
          </span>
          <ChevronRight className="-ml-0.5 size-3 flex-none text-faint" aria-hidden />
        </Link>
      ) : (
        list.map((engine) => {
          const state = engine.enabled ? t`enabled` : t`disabled`
          const name = engine.name
          return (
            <Link
              key={engine.id}
              to="/compute/engines"
              title={t`${name}, ${state} — Compute › Engines`}
              className={row}
            >
              <StatusDot tone={engine.enabled ? 'healthy' : 'away'} />
              <span
                className={cn(
                  'min-w-0 truncate underline-offset-2 group-hover:underline',
                  !engine.enabled && 'text-dim-2',
                )}
              >
                {name}
              </span>
            </Link>
          )
        })
      )}
      {correspondence ? <SearchSlots /> : null}
    </div>
  )
}

/**
 * Design 2b's "Saved filters": the cuts of the library worth one click. Three built-ins
 * plus whatever the filter row's "Save filter" has put there — see `routes/games/
 * savedFilters.ts` for where they live.
 */
function SavedFilterRow({
  filter,
  lit,
  search,
}: {
  filter: SavedFilter
  lit: boolean
  search: string
}) {
  const { t, i18n } = useLingui()
  const { id, filters, dotClass, builtin } = filter
  // The shipped cuts are named by the catalog; a cut the owner saved keeps the words they
  // typed. See `filterLabel`.
  const name = filterLabel(i18n, filter)
  const params = paramsFromFilters(filters)
  const count = useGames({ ...toGameQuery(filters), limit: 1 })

  return (
    <div className="group/saved relative">
      <DotRow
        // Only shown on the library itself, so the order the reader chose goes with them to
        // the next cut rather than falling back to newest first (`libraryLinks`).
        to={carrySort(`/games?${params.toString()}`, '/games', search)}
        lit={lit}
        marker="dot"
        markerClass={dotClass}
        trailing={count.data === undefined ? '' : count.data.total.toLocaleString()}
        // The count gives its place to the forget button while the row is pointed at.
        trailingClass={
          builtin ? undefined : 'group-hover/saved:invisible group-focus-within/saved:invisible'
        }
      >
        {name}
      </DotRow>
      {builtin ? null : (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t`Forget the saved filter “${name}”`}
          title={t`Forget this filter`}
          onClick={() => removeSavedFilter(id)}
          className="absolute top-1/2 right-0.5 hidden size-5 -translate-y-1/2 text-dim group-focus-within/saved:flex group-hover/saved:flex hover:not-disabled:text-blunder"
        >
          <X className="size-3" aria-hidden />
        </Button>
      )}
    </div>
  )
}

function SavedFilters({ search }: { search: string }) {
  const filters = useSavedFilters()
  return (
    <>
      {/* Named, the way "Your lines" is: without it the cuts read as more destinations
          under Games rather than as one list of ways to slice the one below. */}
      <FoldLabel>
        <Trans>Filters</Trans>
      </FoldLabel>
      <CappedRows
        more="/games"
        rows={filters.map((filter) => {
          // Lit only when the library is showing exactly this cut and nothing else — however
          // it is sorted and whichever page it is on, since those are how it is read.
          const lit = showsCut(paramsFromFilters(filter.filters), search)
          return {
            key: filter.id,
            lit,
            node: <SavedFilterRow filter={filter} lit={lit} search={search} />,
          }
        })}
      />
      {filters.length === 0 ? (
        <div className="px-2 py-[0.4375rem] text-data text-dim-2">
          <Trans>No saved filters yet</Trans>
        </div>
      ) : null}
    </>
  )
}

/**
 * The pinned collections, always under the Collections row (decision D4-A): places the owner
 * goes back to, one click from anywhere, in the Collections page's order. At the fold's
 * indent but without its rule, because they are always there and must not look like a fold
 * that opens with its page; each marked by the collection's square swatch. Which ones is the
 * owner's choice ("Show in the rail" in the collection's dialog), and so is how many: the
 * rail used to pin the first two (one in correspondence mode) to fit a 900px window, which
 * pinned whichever sorted first rather than the ones worth a click. Past a few the rail's
 * middle scrolls, as it does with a long fold open.
 *
 * A row opens Games on that collection alone (`pinnedCollectionHref`), and while Games shows
 * exactly that, the row is the lit leaf and the title reads `Collections › <name>`
 * (`lib/libraryPlace`, which both of them ask).
 */
function PinnedCollections({
  collections,
  current,
}: {
  collections: readonly Collection[]
  current: number | null
}) {
  const { t } = useLingui()
  if (useCollapsed() || collections.length === 0) return null
  return (
    <div
      role="group"
      aria-label={t`Pinned collections`}
      className="ml-3 flex flex-col border-l border-transparent pl-1"
    >
      {collections.map((collection) => (
        <DotRow
          key={collection.id}
          to={pinnedCollectionHref(collection.id)}
          lit={collection.id === current}
          marker="swatch"
          markerClass={collectionColorClasses(collection.color).fill}
          trailing={collection.game_count.toLocaleString()}
        >
          {collection.name}
        </DotRow>
      ))}
    </div>
  )
}

/** Design 2c's "Your lines · black": the ECO codes the scoped games keep reaching. */
function YourLines({ search }: { search: string }) {
  const scope = (new URLSearchParams(search).get('color') as Color | null) ?? undefined
  const games = useGames({ limit: LINE_SAMPLE, ...(scope ? { color: scope } : {}) })
  const lines = topLines(games.data?.games, ROWS)
  const { t } = useLingui()
  const scopeLabel =
    scope === 'white' ? t`white` : scope === 'black' ? t`black` : t`both colours`
  const sample = LINE_SAMPLE

  return (
    <>
      <FoldLabel>{t`Your lines · ${scopeLabel}`}</FoldLabel>
      {lines.map(({ eco, name, games: played, score }) => (
        <DotRow
          key={eco}
          to={`/games?eco=${eco}${scope ? `&color=${scope}` : ''}`}
          title={t`${name} — ${played} of your last ${sample} games`}
          leading={<span className="font-mono text-meta text-dim">{eco}</span>}
          trailing={`${Math.round(score)}%`}
          trailingClass={scoreTone(score)}
        >
          {name}
        </DotRow>
      ))}
      {games.isPending || lines.length > 0 ? null : (
        <div className="px-2 py-[0.4375rem] text-data text-dim-2">
          <Trans>No openings on record yet</Trans>
        </div>
      )}
    </>
  )
}

/** Design 2d's "Reports": which aggregation the stats screen is showing. */
function Reports({ search }: { search: string }) {
  const current = reportFrom(search)
  const { i18n } = useLingui()
  return (
    <CappedRows
      more="/stats"
      rows={REPORTS.map((report) => ({
        key: report.key,
        lit: report.key === current,
        node: (
          <DotRow
            to={reportPath(report.key, search)}
            lit={report.key === current}
            title={i18n._(report.hint)}
          >
            {i18n._(report.label)}
          </DotRow>
        ),
      }))}
    />
  )
}

/** Whether `/events` is carrying anything — a dot, because a word would crowd the row. */
function ConnectionDot() {
  const { status, reconnects } = useEvents()
  const { t } = useLingui()
  const label =
    status === 'open'
      ? reconnects > 0
        ? t`live · reconnected ${reconnects}×`
        : t`live`
      : status === 'connecting'
        ? t`connecting to /events`
        : t`offline — retrying`
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'size-[0.375rem] flex-none rounded-full',
        // Green is alive; blue is kept for interaction, so a status never reads as a choice.
        status === 'open'
          ? 'bg-good'
          : status === 'connecting'
            ? 'bg-mistake'
            : 'bg-blunder',
      )}
    />
  )
}

/**
 * The rail's foot: the window's bottom edge, where the app keeps what is about the app
 * rather than about a page. Two rows, about 60px:
 *
 * 1. The engine line (`EnginesLine`): what is set up, and in correspondence mode what its
 *    searches are doing, as one line that is also the way to Compute › Engines.
 * 2. Settings (`SettingsMenu`), opening upward, and after it the live-connection dot: the
 *    one signal that is always there, green while `/events` carries the app's news.
 *
 * It used to be four: the engines, a correspondence strip naming the same machines again,
 * the owner's name borrowed from a chess account, and a row of odds and ends (the fold
 * control, the manual as an icon and a word, the source as an icon, the dot and the
 * version). The fold control went to the brand row, where it is always in the same place;
 * the manual, the source and the version went into Settings, which is where once-in-a-while
 * things live; the strip became the engine line's figure.
 *
 * Folded, the words drop and the same three stay as icons: the chip with its status dot,
 * the gear, the connection dot.
 */
function NavFooter({ collapsed, correspondence }: { collapsed: boolean; correspondence: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-none flex-col items-center gap-1 border-t border-hairline px-1 pt-1.5 pb-1.5">
        <EnginesLine correspondence={correspondence} />
        <SettingsMenu variant="icon" />
        <ConnectionDot />
      </div>
    )
  }
  return (
    <div className="flex flex-none flex-col gap-0.5 border-t border-hairline px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom,0rem))]">
      <EnginesLine correspondence={correspondence} />
      <div className="flex min-w-0 items-center gap-1.5 pr-1.5">
        <SettingsMenu />
        <ConnectionDot />
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
    <SubPages pages={pages} pathname={pathname} />
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
 * The destinations, and which one is lit: the same fragment fills the desktop rail and the
 * phone drawer, so a route added here appears in both.
 *
 * Only the leaf lights (`Mark`). An entry whose fold holds the current place — Stats with
 * its report, Library/Analysis/Compute with a page, Games with a saved cut — is its plain
 * parent. A collection shown whole on Games is the collection's place, not Games': its
 * pinned row lights (or Collections itself, for one that is not pinned), Collections is its
 * parent, and Games stays unlit with its Filters fold shut. That answer comes from
 * `lib/libraryPlace`, which the Games title asks too, so the rail and the bar never disagree.
 */
function NavSections({ correspondence }: { correspondence: boolean }) {
  const { pathname, search } = useLocation()
  const { t } = useLingui()
  const games = useGames({ limit: 1 })
  const live = useLiveState()
  const collections = useCollections().data?.collections ?? []

  const total = games.data?.total
  const liveActive = live.data?.active === true

  // Correspondence mode. The count beside the entry is the one number that decides whether
  // the owner has to do anything today — games waiting on *their* move — which is why it is
  // in the rail rather than on the page. The list is only asked for once the mode is on, so
  // an install that never plays correspondence makes no request for it.
  const corrGames = useCorrespondenceGames(undefined, { enabled: correspondence })
  const yourMove = corrGames.data?.counts.your_move ?? 0

  const onGames = pathname === '/games'
  const place = useLibraryPlace(onGames ? search : '')
  const shownCollection = onGames && place.kind === 'collection' ? place.collectionId ?? null : null
  const pinned = collections.filter((collection) => collection.pinned)
  const pinnedHere = pinned.some((collection) => collection.id === shownCollection)

  const markOf = (to: string): Mark => {
    if (to === '/games') {
      if (shownCollection !== null) return 'idle'
      if (onGames && place.kind === 'cut') return 'parent'
    }
    if (to === '/collections' && shownCollection !== null) return pinnedHere ? 'parent' : 'leaf'
    const here = to === '/' ? pathname === '/' : inSection(pathname, to)
    if (!here) return 'idle'
    // Every report is a leaf of Stats, so on Stats one of them always is.
    if (to === '/stats') return 'parent'
    const pages = SUBPAGES[to]
    if (pages?.some((page) => inSection(pathname, page.to))) return 'parent'
    return 'leaf'
  }

  const entry = (item: NavItem, trailing?: string) => {
    const mark = markOf(item.to)
    return (
      <Fragment key={item.to}>
        <Item item={item} mark={mark} trailing={trailing} />
        {item.to === '/collections' ? (
          <PinnedCollections collections={pinned} current={pinnedHere ? shownCollection : null} />
        ) : null}
        {mark !== 'idle' && item.to !== '/collections' ? (
          <Folded to={item.to} pathname={pathname} search={search} />
        ) : null}
      </Fragment>
    )
  }

  return (
    <>
      {WORKSPACE.map((item) =>
        entry(
          item,
          item.to === '/games' && total !== undefined
            ? total.toLocaleString()
            : item.to === '/live' && liveActive
              ? t`on air`
              : undefined,
        ),
      )}
      {correspondence ? (
        <Item
          item={CORRESPONDENCE}
          mark={markOf(CORRESPONDENCE.to)}
          trailing={yourMove > 0 ? String(yourMove) : undefined}
          // Amber, not the quiet mono of the Games count: this number is a deadline, and
          // the only reason the entry carries one at all.
          trailingClass="text-mistake"
        />
      ) : null}

      <SectionLabel>
        <Trans>Data &amp; compute</Trans>
      </SectionLabel>
      {DATA.map((item) => entry(item))}
    </>
  )
}

/**
 * The rail's first row: the mark, the name and, on the public demo, a flat tint saying so.
 *
 * 42px with its own strong rule, so the bar's band and rule run the window's whole width and
 * the silhouette stays the one the app always had; the brand simply sits in the rail's
 * column now. The demo tint is a fact about this instance and a way out (↗ to where a copy
 * of one's own comes from), so it is a flat tint with no border, not a control; "read-only"
 * went to its `title`, where the sentence has room. In the drawer the close button ends
 * the row.
 *
 * On the desktop the fold control ends it: the right end of the brand row is where a
 * sidebar's fold lives in most apps, always in the same place, and it used to be the first
 * of five odds and ends in the foot. Folded, the mark itself is the way back out — it turns
 * into the unfold glyph under the pointer, so the 52px strip needs no second button.
 */
function BrandRow({ onClose, onToggle }: { onClose?: () => void; onToggle?: () => void }) {
  const collapsed = useCollapsed()
  const capabilities = useRuntimeCapabilities()
  const { t } = useLingui()
  const mark = (
    // The brand mark is drawn for a light ground (a near-black pawn with a teal band), so
    // the light theme takes it as-is; inverting it and putting the hue back is what makes
    // it legible on the dark `--bb-panel` without shipping a second asset.
    <img
      src="/logo.png"
      alt=""
      className="size-[1.1875rem] flex-none dark:[filter:invert(1)_hue-rotate(180deg)]"
    />
  )
  if (collapsed && onToggle) {
    const label = t`Expand the navigation`
    return (
      <div className="flex h-[calc(2.625rem+env(safe-area-inset-top,0rem))] flex-none items-center justify-center border-b border-edge-strong pt-[env(safe-area-inset-top,0rem)]">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label={label}
          aria-expanded={false}
          title={label}
          className="group"
        >
          <span className="group-hover:hidden group-focus-visible:hidden">{mark}</span>
          <PanelLeftOpen
            className="hidden size-4 text-dim group-hover:block group-focus-visible:block"
            aria-hidden
          />
        </Button>
      </div>
    )
  }
  return (
    <div
      className={cn(
        'flex h-[calc(2.625rem+env(safe-area-inset-top,0rem))] flex-none items-center gap-2 border-b border-edge-strong pt-[env(safe-area-inset-top,0rem)]',
        collapsed ? 'justify-center px-0' : 'px-3',
      )}
    >
      <Link
        to="/"
        aria-label={collapsed ? 'Blunderbase' : undefined}
        className="flex min-w-0 items-center gap-2 rounded-md"
      >
        {mark}
        {collapsed ? null : (
          <span className="truncate text-lead font-semibold tracking-[-0.01em] text-ink">
            Blunderbase
          </span>
        )}
      </Link>
      {capabilities.read_only && !collapsed ? (
        <a
          href={SITE_URL}
          target="_blank"
          rel="noreferrer"
          title={t`This is the public demo · read-only: look at everything, change nothing. Get your own Blunderbase at blunderbase.org.`}
          className="ml-auto inline-flex flex-none items-center gap-[0.1875rem] rounded-sm bg-chip-info px-1.5 text-label font-medium text-info transition-colors hover:text-ink"
        >
          <Trans>Demo</Trans>
          <ArrowUpRight className="size-3" aria-hidden />
        </a>
      ) : null}
      {onClose ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t`Close the navigation`}
          className={cn('-mr-1 text-dim', !capabilities.read_only && 'ml-auto')}
        >
          <X className="size-4" aria-hidden />
        </Button>
      ) : onToggle ? (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onToggle}
          aria-label={t`Collapse the navigation`}
          aria-expanded
          title={t`Collapse the navigation`}
          className={cn('-mr-1 text-dim', !capabilities.read_only && 'ml-auto')}
        >
          <PanelLeftClose className="size-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}

/**
 * "Search everything": the ⌘K palette's way in, drawn as a field because it is one (it opens
 * a box to type in), where the old bare `⌘K` keycap read as a status chip. "Everything",
 * not "Search", because Games and Notes have their own filter fields on the same screen.
 * Folded, a magnifier.
 */
function SearchField({ onOpen }: { onOpen?: () => void }) {
  const collapsed = useCollapsed()
  const palette = useCommandPalette()
  const { t } = useLingui()
  const open = () => {
    onOpen?.()
    palette.open()
  }
  if (collapsed) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={open}
        aria-label={t`Search everything`}
        title={t`Search everything (⌘K)`}
        className="mx-auto mt-2 mb-1 flex-none text-dim"
      >
        <Search className="size-3.5" aria-hidden />
      </Button>
    )
  }
  return (
    <button
      type="button"
      onClick={open}
      aria-label={t`Search everything`}
      title={t`Search everything (⌘K)`}
      className="mt-2 mb-1 flex h-7 w-full flex-none items-center gap-1.5 rounded-md border border-edge-input bg-field px-2 text-left text-data text-dim shadow-field transition-colors hover:border-edge-hover hover:text-body"
    >
      <Search className="size-3.5 flex-none" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <Trans>Search everything</Trans>
      </span>
      <span aria-hidden className="font-mono text-meta text-dim-2">
        ⌘K
      </span>
    </button>
  )
}

/**
 * Everything the rail holds, without the frame around it: brand, then the part that may
 * scroll (search and the destinations), then the foot. The desktop rail and the phone
 * drawer both render this, so a route added here appears in both.
 *
 * The middle is the only part that scrolls, and only when it must (correspondence mode on,
 * with its strip busy, on a short window): the brand row and the foot never move, and the
 * scrollbar is left visible, so there is always a sign that more is below.
 */
function RailBody({
  collapsed,
  foldable,
  onToggle,
  onClose,
}: {
  collapsed: boolean
  foldable: boolean
  onToggle: () => void
  onClose?: () => void
}) {
  const settings = useAppSettings()
  const correspondence =
    (settings.data?.correspondence_enabled ?? SETTING_DEFAULTS.correspondence_enabled) === 1
  return (
    <>
      <BrandRow onClose={onClose} onToggle={foldable ? onToggle : undefined} />
      <div
        data-testid="rail-middle"
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto pb-2',
          collapsed ? 'px-1.5' : 'px-2',
        )}
      >
        <SearchField onOpen={onClose} />
        <NavSections correspondence={correspondence} />
      </div>
      <NavFooter collapsed={collapsed} correspondence={correspondence} />
    </>
  )
}

/**
 * The rail, and the fold it remembers.
 *
 * Folded it is an icon strip: every destination keeps a row and a tooltip, and everything
 * that is words — the heading, the counts, the open entry's second level, the pinned
 * collections, the foot's names — stands down until it comes back. That is a narrower rail
 * rather than no rail, because a rail that vanishes has to put the way back somewhere else,
 * and there is nowhere on this window that is not already spoken for.
 *
 * The choice is this component's rather than the shell's: nothing above it needs to know,
 * the column beside it is `minmax(0, 1fr)` and simply takes the width back, and
 * `localStorage` is what carries it across a reload.
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

  const { t } = useLingui()

  return (
    <Collapsed.Provider value={collapsed}>
      <nav
        aria-label={t`Sections`}
        className={cn(
          // The fold is a width that moves rather than a width that jumps; the labels are
          // clipped for the 200ms rather than wrapped, which is what `overflow-hidden` and
          // `whitespace-nowrap` are for. Nothing in the rail is prose, so nothing selects.
          'flex min-h-0 flex-none flex-col overflow-hidden border-r border-edge-strong bg-panel whitespace-nowrap transition-[width] duration-200 ease-out select-none max-md:hidden',
          collapsed ? 'w-[3.25rem]' : 'w-50',
        )}
      >
        <RailBody collapsed={collapsed} foldable onToggle={toggle} />
      </nav>
    </Collapsed.Provider>
  )
}

const noop = () => {}

/**
 * The rail on a phone: the same rail, in the same order, over the page instead of beside
 * it — brand and demo tint (with the close button), search, the destinations, then the foot
 * with the engine line and Settings. Never folded, so there is
 * no fold control; the theme is in the Settings menu here as on a desktop.
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
  const { t } = useLingui()

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
        aria-label={t`Sections`}
        className="relative flex h-full w-[17rem] max-w-[85vw] flex-col border-r border-edge-strong bg-panel shadow-[0_0_2rem_var(--bb-shadow)] outline-none select-none duration-200 animate-in slide-in-from-left pl-[env(safe-area-inset-left,0rem)]"
      >
        <Collapsed.Provider value={false}>
          <RailBody collapsed={false} foldable={false} onToggle={noop} onClose={onClose} />
        </Collapsed.Provider>
      </nav>
    </div>
  )
}
