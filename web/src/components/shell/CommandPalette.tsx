/**
 * ⌘K: the one box over the whole app.
 *
 * Two halves that never mix. The "Pages" group is client-side and answers instantly —
 * the workspace routes, the stats reports and the owner's saved filters are all things
 * this build already knows, so asking the backend where the Stats page is would only add
 * a frame of nothing. The other four groups are `GET /search`, which the backend holds
 * back until the query is two characters long.
 *
 * Everything a row can be is flattened into one list before it is drawn, because the
 * highlight moves across the *groups*, not within them: ↓ from the last page lands on the
 * first game. The groups are only how the flat list is printed.
 */
import {
  Bot,
  ChartNoAxesColumn,
  Cpu,
  Database,
  Gauge,
  LayoutDashboard,
  Library,
  Network,
  Radio,
  Signpost,
  StickyNote,
  Swords,
  User,
} from 'lucide-react'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'

import { useSearch } from '@/lib/api/queries'
import type { GameSummary, NoteResponse, OpeningHit, OpponentHit } from '@/lib/api/types'
import type { RuntimeCapabilities } from '@/lib/api/types'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { cn } from '@/lib/utils'
import { paramsFromFilters } from '@/routes/games/filters'
import { formatGameDate, formatResult, outcomeTone } from '@/routes/games/format'
import { useSavedFilters } from '@/routes/games/savedFilters'
import { noteHref, oneLine } from '@/routes/notes/grouping'
import { REPORTS } from '@/routes/stats/reports'

/** Under this the backend answers four empty groups, so the box says so itself. */
const MIN_QUERY = 2
/** Per group. The dialog is a jump list, not a results page — five is a glance. */
const PER_GROUP = 5

type GroupName = 'Pages' | 'Games' | 'Opponents' | 'Openings' | 'Notes'

interface PaletteItem {
  /** Unique across every group — it is the React key and the highlight's identity. */
  id: string
  group: GroupName
  label: string
  /** The dim half of the row: what the label does not already say. */
  hint?: string
  /** Right-aligned, monospaced — a date, a count, a result. */
  trailing?: string
  trailingClass?: string
  icon: ComponentType<{ className?: string }>
  to: string
}

// --- the pages half -------------------------------------------------------

interface PageRoute {
  label: string
  hint: string
  icon: ComponentType<{ className?: string }>
  to: string
}

/**
 * The workspace, as the rail lists it plus the two screens the rail keeps in its footer
 * and its menus. This is the empty-query list: what you get for pressing ⌘K and Enter.
 */
const PAGES: PageRoute[] = [
  { label: 'Dashboard', hint: 'the last games and what went wrong', icon: LayoutDashboard, to: '/' },
  { label: 'Games', hint: 'the library', icon: Library, to: '/games' },
  { label: 'Openings', hint: 'the explorer', icon: Network, to: '/explorer' },
  { label: 'Stats', hint: 'reports over the library', icon: ChartNoAxesColumn, to: '/stats' },
  { label: 'Notes', hint: 'everything written down', icon: StickyNote, to: '/notes' },
  { label: 'Live', hint: 'the game being played now', icon: Radio, to: '/live' },
  {
    label: 'Library',
    hint: 'import, export and reset',
    icon: Database,
    to: '/library',
  },
  {
    label: 'Analysis',
    hint: 'coverage, backfills and what they cost',
    icon: Gauge,
    to: '/analysis',
  },
  { label: 'Engines', hint: 'the roster and what runs what', icon: Cpu, to: '/engines' },
  { label: 'Engine passes', hint: 'budgets and move labels', icon: Gauge, to: '/analysis/engine' },
  { label: 'Maia', hint: 'human levels and when they run', icon: Gauge, to: '/analysis/maia' },
  {
    label: 'Import',
    hint: 'lichess, chess.com, FICS and PGN',
    icon: Database,
    to: '/library/import',
  },
  {
    label: 'Manage Library',
    hint: 'export or reset',
    icon: Database,
    to: '/library/manage',
  },
  { label: 'Assistant', hint: 'MCP keys and client setup', icon: Bot, to: '/assistant' },
]

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true
  return fields.some((field) => field?.toLowerCase().includes(query))
}

/**
 * Every page-shaped row the query touches.
 *
 * An empty query is deliberately *not* everything: the reports and the saved filters are
 * only worth the space once they have been asked for, so the resting list is the nine
 * routes and nothing else.
 */
function pageItems(
  query: string,
  saved: ReturnType<typeof useSavedFilters>,
  capabilities: RuntimeCapabilities,
): PaletteItem[] {
  const items: PaletteItem[] = PAGES.filter(
    (page) =>
      (capabilities.mcp || page.to !== '/assistant') && matches(query, page.label, page.hint),
  ).map((page) => ({
    id: `page:${page.to}`,
    group: 'Pages',
    label: page.label,
    hint: page.hint,
    icon: page.icon,
    to: page.to,
  }))
  if (!query) return items

  for (const report of REPORTS) {
    if (!matches(query, report.label, report.hint, 'stats report')) continue
    items.push({
      id: `report:${report.key}`,
      group: 'Pages',
      label: report.label,
      hint: `report · ${report.hint}`,
      icon: ChartNoAxesColumn,
      to: `/stats?report=${report.key}`,
    })
  }

  for (const filter of saved) {
    if (!matches(query, filter.label, 'saved filter')) continue
    items.push({
      id: `filter:${filter.id}`,
      group: 'Pages',
      label: filter.label,
      hint: 'saved filter',
      icon: Signpost,
      to: `/games?${paramsFromFilters(filter.filters).toString()}`,
    })
  }
  return items
}

// --- the searched half ----------------------------------------------------

/** `kn1ghtmare vs Dr_Nykterstein` — whoever the two were, in the colours they had. */
function gameLabel(game: GameSummary): string {
  const white = game.white ?? '?'
  const black = game.black ?? '?'
  return `${white} vs ${black}`
}

function gameHint(game: GameSummary): string {
  const parts = [game.opening ?? game.eco ?? null, game.speed ?? null].filter(Boolean)
  return parts.join(' · ')
}

function searchItems(
  games: GameSummary[],
  opponents: OpponentHit[],
  openings: OpeningHit[],
  notes: NoteResponse[],
): PaletteItem[] {
  const items: PaletteItem[] = []

  for (const game of games) {
    items.push({
      id: `game:${game.id}`,
      group: 'Games',
      label: gameLabel(game),
      hint: gameHint(game),
      trailing: `${formatResult(game.result)}  ${formatGameDate(game.played_at)}`,
      trailingClass: outcomeTone(game.outcome),
      icon: Swords,
      to: `/games/${game.id}`,
    })
  }

  for (const opponent of opponents) {
    items.push({
      id: `opponent:${opponent.name}`,
      group: 'Opponents',
      label: opponent.name,
      hint: `${opponent.games} ${opponent.games === 1 ? 'game' : 'games'}`,
      trailing: `${Math.round(opponent.score)}%`,
      icon: User,
      to: `/games?opponent=${encodeURIComponent(opponent.name)}`,
    })
  }

  for (const opening of openings) {
    items.push({
      id: `opening:${opening.eco}:${opening.name}`,
      group: 'Openings',
      label: opening.name || opening.eco,
      hint: opening.name ? opening.eco : '',
      trailing: `${opening.games}`,
      icon: Network,
      to: `/games?eco=${encodeURIComponent(opening.eco)}`,
    })
  }

  for (const note of notes) {
    // Every note lands somewhere now: one that knows its game opens that game at the ply
    // it is about, and one pinned to a bare position opens the notes screen on itself
    // (`noteHref`), where the position is drawn and the note can be rewritten.
    items.push({
      id: `note:${note.id}`,
      group: 'Notes',
      label: oneLine(note),
      hint: note.tags.length ? note.tags.join(' · ') : 'note',
      trailing: formatGameDate(note.updated_at),
      icon: StickyNote,
      to: noteHref(note),
    })
  }

  return items
}

// --- the dialog -----------------------------------------------------------

const GROUP_ORDER: GroupName[] = ['Pages', 'Games', 'Opponents', 'Openings', 'Notes']

function Row({
  item,
  active,
  onPick,
}: {
  item: PaletteItem
  active: boolean
  onPick: () => void
}) {
  const row = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (active) row.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const Icon = item.icon
  return (
    <button
      ref={row}
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      // Down, not click: the input keeps focus, so the highlight never flickers away.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
        active ? 'bg-raised text-ink' : 'text-soft hover:bg-raised/60',
      )}
    >
      <Icon className={cn('size-3.5 flex-none', active ? 'text-accent-teal' : 'text-faint')} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[0.71875rem]">{item.label}</span>
      {item.hint ? (
        <span className="max-w-[42%] flex-none truncate text-[0.625rem] text-dim">{item.hint}</span>
      ) : null}
      {item.trailing ? (
        <span className={cn('flex-none font-mono text-[0.625rem] tabular', item.trailingClass ?? 'text-dim-2')}>
          {item.trailing}
        </span>
      ) : null}
    </button>
  )
}

function Dialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const saved = useSavedFilters()
  const search = useSearch(query, PER_GROUP)
  const capabilities = useRuntimeCapabilities()

  const needle = query.trim().toLowerCase()
  const answered = search.data

  const items = useMemo(() => {
    const pages = pageItems(needle, saved, capabilities)
    if (needle.length < MIN_QUERY || !answered) return pages
    return [
      ...pages,
      ...searchItems(answered.games, answered.opponents, answered.openings, answered.notes),
    ]
  }, [needle, saved, answered, capabilities])

  // A new set of rows starts at the top: the highlight belongs to the list, not to a
  // position that happened to survive a keystroke. Adjusted during the render that
  // changed the query rather than in an effect, so no frame is drawn on the old index.
  const [highlighted, setHighlighted] = useState(needle)
  if (highlighted !== needle) {
    setHighlighted(needle)
    setActive(0)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (items.length === 0) return
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((was) => (was + step + items.length) % items.length)
        return
      }
      if (event.key === 'Enter') {
        const item = items[active]
        if (!item) return
        event.preventDefault()
        onClose()
        navigate(item.to)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [items, active, navigate, onClose])

  function pick(item: PaletteItem) {
    onClose()
    navigate(item.to)
  }

  const searching = needle.length >= MIN_QUERY

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/75 px-6 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        className="bb-card flex w-full max-w-[34rem] flex-col overflow-hidden shadow-[0_1rem_3rem_var(--bb-shadow)]"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-2.5">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search games, opponents, openings, notes…"
            aria-label="Search everything"
            aria-controls="command-palette-results"
            className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="flex-none rounded border border-edge px-1.5 py-0.5 font-mono text-[0.625rem] text-faint">
            esc
          </kbd>
        </div>

        <div
          id="command-palette-results"
          role="listbox"
          aria-label="Results"
          className="flex max-h-[26rem] flex-col gap-0.5 overflow-y-auto p-1.5"
        >
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-[0.6875rem] text-dim">
              {searching && search.isFetching ? 'Searching…' : 'Nothing matches that.'}
            </p>
          ) : (
            GROUP_ORDER.map((group) => {
              const rows = items.filter((item) => item.group === group)
              if (rows.length === 0) return null
              return (
                <div key={group} className="flex flex-col gap-0.5">
                  <div className="px-2 pt-1.5 pb-1 text-[0.625rem] tracking-[0.12em] text-faint uppercase">
                    {group}
                  </div>
                  {rows.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      active={items[active]?.id === item.id}
                      onPick={() => pick(item)}
                    />
                  ))}
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-hairline px-3.5 py-2 text-[0.625rem] text-faint">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span className="flex-1" />
          {searching ? null : <span>type two letters to search the library</span>}
        </div>
      </div>
    </div>
  )
}

// --- mounting it ----------------------------------------------------------

/** The one thing anything outside the shell wants: a way to raise the box. */
const PaletteContext = createContext<{ open: () => void }>({ open: () => {} })

/** The titlebar's ⌘K chip, and anything else that grows a reason to open it. */
export function useCommandPalette() {
  return useContext(PaletteContext)
}

/**
 * Mounted once, around the whole shell, so ⌘K works on every route and the dialog
 * survives the page under it changing.
 *
 * Ctrl+K is taken alongside ⌘K rather than instead of it: the app runs on a laptop and on
 * whatever machine the engines are on, and the shortcut that is printed in the titlebar
 * should work on both.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ open: () => setOpen(true) }), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      setOpen((was) => !was)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <PaletteContext.Provider value={value}>
      {children}
      {/* Remounted on every open, so the box always comes up empty and at the top. */}
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </PaletteContext.Provider>
  )
}
