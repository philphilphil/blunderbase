/**
 * The 200px workspace rail from the design.
 *
 * Three parts, on every frame: the workspace list (with the Games count and the red
 * Blunder-log count), a second section that changes with the screen — Saved filters on the
 * library, Your lines in the explorer, Reports on stats, the engine roster everywhere else
 * — and a pinned footer.
 *
 * The design's footer reads "Storage · local / 2.4 GB / 3.8 GB". Nothing in the API
 * reports disk usage, so the same three-line treatment carries numbers that are true: how
 * much of the library has had a deep pass over it.
 */
import {
  ChartNoAxesColumn,
  Cpu,
  Download,
  Flame,
  LayoutDashboard,
  Library,
  Radio,
  Network,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

import { useEngines, useGames, useLiveState } from '@/lib/api/queries'
import type { Color } from '@/lib/api/types'
import { paramsFromFilters, toGameQuery } from '@/routes/games/filters'
import {
  removeSavedFilter,
  useSavedFilters,
  type SavedFilter,
} from '@/routes/games/savedFilters'
import { REPORTS, reportFrom } from '@/routes/stats/reports'
import { cn } from '@/lib/utils'

import { LINE_SAMPLE, scoreTone, topLines } from './openingLines'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
}

const WORKSPACE: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/games', label: 'Games', icon: Library },
  { to: '/explorer', label: 'Openings', icon: Network },
  { to: '/stats', label: 'Stats', icon: ChartNoAxesColumn },
  { to: '/live', label: 'Live', icon: Radio },
]

const DATA: NavItem[] = [
  { to: '/import', label: 'Import', icon: Download },
  { to: '/settings/engines', label: 'Engines', icon: Cpu },
]

/** The library filtered to the games a blunder was found in — the design's blunder log. */
const BLUNDER_LOG = '/games?has_blunders=true'

const ROWS = 4

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-1.5 pb-2 text-[0.625rem] tracking-[0.12em] text-faint uppercase">
      {children}
    </div>
  )
}

function Item({
  item,
  trailing,
  trailingClass,
  active,
}: {
  item: NavItem
  trailing?: string
  trailingClass?: string
  /** Overrides the route match — the blunder log is a query on a route of its own. */
  active?: boolean
}) {
  const Icon = item.icon
  const state = (isActive: boolean) => active ?? isActive
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2 py-[0.4375rem] text-[0.8125rem] transition-colors',
          state(isActive)
            ? 'bg-raised-2 font-medium text-ink shadow-[inset_0.125rem_0_0_var(--bb-accent)]'
            : 'text-soft hover:bg-raised hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn('size-3.5', state(isActive) ? 'text-accent-teal' : 'text-faint')}
          />
          {item.label}
          {trailing ? (
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
        'flex items-center gap-2.5 rounded-md px-2 py-[0.4375rem] text-[0.78125rem] transition-colors',
        active ? 'bg-raised text-ink' : 'text-soft hover:bg-raised hover:text-ink',
      )}
    >
      {dotClass ? <span className={cn('mx-1 size-1.5 flex-none rounded-full', dotClass)} /> : null}
      {leading}
      <span className="truncate">{children}</span>
      {trailing !== undefined ? (
        <>
          <span className="flex-1" />
          <span className={cn('font-mono text-[0.6875rem] tabular text-dim', trailingClass)}>
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
          <span
            className={cn(
              'mx-1 size-1.5 flex-none rounded-full',
              engine.enabled ? 'bg-accent-teal' : 'bg-faint',
            )}
          />
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
          className="absolute inset-y-0 right-1 hidden items-center px-1 text-faint hover:text-blunder group-hover/saved:flex"
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
      <SectionLabel>Saved filters</SectionLabel>
      {filters.map((filter) => (
        <SavedFilterRow key={filter.id} {...filter} search={search} />
      ))}
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
      <SectionLabel>{`Your lines · ${scope ?? 'both colours'}`}</SectionLabel>
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
      <SectionLabel>Reports</SectionLabel>
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

/**
 * The pinned footer. Its label follows the screen the way the design's does — "Book" in the
 * explorer, "Sample" on stats — and the bar is the share of the library a deep pass has
 * been over, which is the closest thing to "how full is this database" the API can answer.
 */
function NavFooter({ pathname }: { pathname: string }) {
  const all = useGames({ limit: 1 })
  const deep = useGames({ deep_analyzed: true, limit: 1 })
  const total = all.data?.total
  const analysed = deep.data?.total
  const share = total && analysed !== undefined ? Math.min(100, (analysed / total) * 100) : 0

  const label = pathname.startsWith('/explorer')
    ? 'Book · your games'
    : pathname.startsWith('/stats')
      ? 'Sample'
      : 'Library · local'
  const figure =
    total === undefined
      ? '—'
      : pathname.startsWith('/explorer')
        ? `${total.toLocaleString()} games indexed`
        : pathname.startsWith('/stats')
          ? `${total.toLocaleString()} games`
          : `${(analysed ?? 0).toLocaleString()} / ${total.toLocaleString()} deep`

  return (
    <div
      className="flex flex-col gap-[0.3125rem] border-t border-hairline px-2 pt-3 pb-1"
      title="Every game, note and evaluation lives in a local database on this machine."
    >
      <div className="text-[0.6875rem] text-dim">{label}</div>
      <div className="h-[0.1875rem] overflow-hidden rounded-sm bg-hairline">
        <div className="h-full bg-meter-2" style={{ width: `${share}%` }} />
      </div>
      <div className="font-mono text-[0.625rem] tabular text-dim-2">{figure}</div>
    </div>
  )
}

/** The second section, which is the screen's own: filters, lines, reports or engines. */
function ContextSection({ pathname, search }: { pathname: string; search: string }) {
  if (pathname === '/games') return <SavedFilters search={search} />
  if (pathname.startsWith('/explorer')) return <YourLines search={search} />
  if (pathname.startsWith('/stats')) return <Reports search={search} />
  return <EngineRoster />
}

export function SideNav() {
  const { pathname, search } = useLocation()
  const games = useGames({ limit: 1 })
  const blunders = useGames({ has_blunders: true, limit: 1 })
  const live = useLiveState()

  const total = games.data?.total
  const flagged = blunders.data?.total
  const liveActive = live.data?.active === true
  // The blunder log is the library under one filter, so the two rows share a route: the
  // one the query string names is the one that lights up.
  const onBlunderLog =
    pathname === '/games' && new URLSearchParams(search).get('has_blunders') === 'true'

  return (
    <nav className="flex w-50 flex-none flex-col gap-0.5 border-r border-hairline bg-panel px-2.5 py-3.5">
      <SectionLabel>Workspace</SectionLabel>
      {WORKSPACE.map((item) => (
        <Item
          key={item.to}
          item={item}
          active={item.to === '/games' && onBlunderLog ? false : undefined}
          trailing={
            item.to === '/games' && total !== undefined
              ? total.toLocaleString()
              : item.to === '/live' && liveActive
                ? 'on air'
                : undefined
          }
        />
      ))}
      <Item
        item={{ to: BLUNDER_LOG, label: 'Blunder log', icon: Flame }}
        active={onBlunderLog}
        trailing={flagged ? flagged.toLocaleString() : undefined}
        trailingClass="text-blunder"
      />

      <div className="h-3.5" />
      <SectionLabel>Data</SectionLabel>
      {DATA.map((item) => (
        <Item key={item.to} item={item} />
      ))}

      <div className="h-3.5" />
      <ContextSection pathname={pathname} search={search} />

      <div className="flex-1" />
      <NavFooter pathname={pathname} />
    </nav>
  )
}
