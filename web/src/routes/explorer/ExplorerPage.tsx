/**
 * Design 2c — the opening explorer.
 *
 * Board on the left, the owner's own tree on the right. `/explorer` is keyed by position,
 * so the line is replayed client-side (`line.ts`) and the resulting FEN is what the endpoint
 * is asked about; the line itself rides in the URL, which makes any position in the tree a
 * link and makes the browser's back button walk the tree backwards for free.
 *
 * One deliberate departure from the 2c mock: the board keeps design 1a's *edge* coordinates
 * rather than 2c's three sparse in-square corner labels. One board component serves every
 * screen, and chessground's in-square mode (`coordinates="inside"`, design 1b) labels every
 * file and rank rather than three corners — so 2c's treatment is not available without a
 * third coordinate renderer, and a board that changes its coordinates per screen reads as
 * two different boards.
 *
 * ## Three sources, and the wall between them
 *
 * `?source=` is 2c's `my games / masters / both` control, finally switchable: the owner's
 * own games, Lichess's masters database, or its rated games (`/reference/*`, which proxies
 * Lichess and stores nothing). Two rules hold the page together:
 *
 * - **No source is ever mixed with another.** There is no `both`. A reference count is
 *   thousands of strangers and the owner's is a handful of their own games; added together
 *   the second disappears, and the number that is actually about them — how *they* have
 *   done in this line — would be diluted by a database they have never played in.
 * - The owner-only panels are hidden rather than blanked on a reference source: the book
 *   run, the line summary and the games in this line are all statements about the owner's
 *   library, and there is no honest reference answer to any of them. The colour scope is
 *   the one exception — it stays beside the source control at the head of the tree pane
 *   and goes inert instead of vanishing, so the pane never reflows on a source switch.
 *   `PositionNotes` is the one thing that stays on every source, because a note is about
 *   the position on the board and the board is the same board.
 *
 * The line, the scope, the source and the lichess filters all ride in the URL, so any
 * position in any book is a link and the back button walks backwards for free. The filters
 * and the scope are lenses (`replace: true`) — which book you are reading is not a place
 * you went — while playing a move is history.
 */
import type { Api } from '@lichess-org/chessground/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Board } from '@/components/board/Board'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { useExplorer, usePositionOccurrences, useReferenceExplorer } from '@/lib/api/queries'
import type { Color, ExplorerMove } from '@/lib/api/types'
import { isTyping } from '@/lib/ui/shortcuts'
import { cn } from '@/lib/utils'

import { GamesInLine } from './components/GamesInLine'
import { LineBreadcrumb } from './components/LineBreadcrumb'
import { LineSummary } from './components/LineSummary'
import { ModelGames } from './components/ModelGames'
import { MoveTreeTable } from './components/MoveTreeTable'
import { PositionNotes } from './components/PositionNotes'
import { ReferenceFilters } from './components/ReferenceFilters'
import { ReferenceMoveTable } from './components/ReferenceMoveTable'
import { ReferenceTokenCard } from './components/ReferenceTokenCard'
import {
  buildLine,
  formatLineParam,
  parseLineParam,
  truncateTo,
  withMove,
  type LinePosition,
} from './line'
import {
  SOURCES,
  SOURCE_LABELS,
  formatCsv,
  parseRatings,
  parseSource,
  parseSpeeds,
  tokenTrouble,
  type ExplorerSource,
  type Speed,
} from './reference'
import { commonOpening } from './stats'

/** How many continuations and how many games to ask for. */
const MOVE_LIMIT = 24
const GAME_LIMIT = 14

/**
 * The same two numbers for a reference source, inside the backend's own caps (30 and 15).
 * A reference position has a long tail of moves played twice in a million games, so the
 * list is shorter than the owner's own tree rather than longer.
 */
const REFERENCE_MOVE_LIMIT = 20
const REFERENCE_GAME_LIMIT = 10

// `viewOnly` is one of the three keys chessground only reads at creation (`Board`'s own
// comment), so toggling it per hover would rebuild the board on every pointer-enter and
// -leave — dropping the `movable.dests` effect below, which only reapplies them on
// `line.dests` changing. An empty dests map gets the same "no drag can start" protection
// through a plain `set()`, no rebuild involved.
const NO_DESTS: LinePosition['dests'] = new Map()

export function ExplorerPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  /**
   * The game whose Book tab sent the reader here, if one did (`GamePage`'s `openInExplorer`
   * puts it in router state, the mirror of what `ModelGames` does going the other way).
   *
   * The explorer is a place you *arrive* at from a game — same position, more of it — and
   * without a way back the reader has to remember which game they were reading and find it
   * again in the library. Router state rather than a query parameter: it is not part of
   * which position is on the board. Anything that is not a game URL is ignored rather than
   * trusted, since state is hand-writable.
   */
  const location = useLocation()
  const cameFrom = (location.state as { from?: unknown } | null)?.from
  const backToGame =
    typeof cameFrom === 'string' &&
    (cameFrom.startsWith('/games/') || cameFrom.startsWith('/reference/'))
      ? cameFrom
      : null

  const ucis = useMemo(() => parseLineParam(params.get('line')), [params])
  const scope = (params.get('color') as Color | null) ?? undefined
  const source = parseSource(params.get('source'))
  const reference = source !== 'mine'
  // Read on every source so the two are stable objects for the query key, but only sent
  // when the lichess database is the one being asked — masters has neither.
  const speeds = useMemo(() => parseSpeeds(params.get('speeds')), [params])
  const ratings = useMemo(() => parseRatings(params.get('ratings')), [params])
  // `?fen=` roots the tree at a position whose move order nobody recorded — how a note
  // written about a position links back here, and how the coach can hand over a board.
  // `?line=` still walks from it, so the two compose and the breadcrumb stays honest: it
  // shows the moves actually played from the root, and nothing before it.
  const rootFen = params.get('fen')
  const line = useMemo(() => buildLine(ucis, rootFen), [ucis, rootFen])

  const [flipped, setFlipped] = useState(false)
  const boardApi = useRef<Api | null>(null)
  // The longest line visited, so "forward" can walk back into what was just undone.
  const trail = useRef<string[]>(ucis)

  // A hovered continuation from a table row, played on the board without touching the
  // URL or the selected line, so the
  // back button still walks the real tree, not a preview nobody chose. Tagged with the line
  // it was hovered from and checked against the current one at render time, the same idiom
  // `useLinePreview` uses: kept rather than cleared by an effect, so a click that plays the
  // hovered move (which changes the line but not necessarily the hover) never leaves a stale
  // preview one or more plies ahead of the line it just produced.
  const [previewed, setPreviewed] = useState<{ line: string; continuation: string[] } | null>(
    null,
  )
  const preview =
    previewed?.line === formatLineParam(ucis) && previewed.continuation.length > 0
      ? previewed.continuation
      : null
  const onPreview = useCallback(
    (continuation: string[] | null) =>
      setPreviewed(
        continuation && continuation.length > 0
          ? { line: formatLineParam(ucis), continuation }
          : null,
      ),
    [ucis],
  )
  const previewLine = useMemo(
    () => (preview ? buildLine([...ucis, ...preview]) : null),
    [ucis, preview],
  )

  /**
   * The way back, carried along by every navigation this page makes.
   *
   * Playing a move writes a new history entry, and router state does not survive one unless
   * it is handed over again — so without this the "Back to game" button would vanish the
   * moment the reader played a move, which is the first thing anybody does here.
   */
  const carried = useMemo(() => (backToGame ? { from: backToGame } : undefined), [backToGame])

  const setLine = useCallback(
    (next: readonly string[], { remember = true }: { remember?: boolean } = {}) => {
      if (remember) trail.current = [...next]
      const updated = new URLSearchParams(params)
      if (next.length === 0) updated.delete('line')
      else updated.set('line', formatLineParam(next))
      setParams(updated, { state: carried })
    },
    [carried, params, setParams],
  )

  /**
   * A lens over one param: what the page is *looking at* rather than where it went, so it
   * replaces the history entry instead of adding one. The colour scope, the source and the
   * two lichess filters are all this; only playing a move is history.
   */
  const setLens = useCallback(
    (key: string, value: string | null) => {
      const updated = new URLSearchParams(params)
      if (value) updated.set(key, value)
      else updated.delete(key)
      setParams(updated, { replace: true, state: carried })
    },
    [carried, params, setParams],
  )

  const setScope = useCallback(
    (next: Color | undefined) => setLens('color', next ?? null),
    [setLens],
  )

  const tree = useExplorer(
    {
      fen: line.fen,
      color: scope,
      limit: MOVE_LIMIT,
      // Naming only — the tree is still the one `fen` asks for. The book stops naming
      // positions a few plies in, so the path is what lets a deep position take its name
      // from the ancestor that has one.
      line: formatLineParam(line.steps.map((step) => step.uci)),
    },
    // A reference source hides everything this tree feeds, so it is not asked for. The
    // answer stays in the cache, which is what makes switching back instant.
    { enabled: !reference },
  )
  const occurrences = usePositionOccurrences(
    line.fen,
    { color: scope, limit: GAME_LIMIT },
    { enabled: !reference },
  )
  const book = useReferenceExplorer(
    {
      // Never asked while the source is `mine`; a placeholder keeps the key stable rather
      // than making the type of the query depend on which pane is showing.
      source: reference ? source : 'masters',
      fen: line.fen,
      moves: REFERENCE_MOVE_LIMIT,
      top_games: REFERENCE_GAME_LIMIT,
      ...(source === 'lichess'
        ? { speeds: formatCsv(speeds), ratings: formatCsv(ratings) }
        : {}),
    },
    { enabled: reference },
  )
  const tokenReason = tokenTrouble(book.error)

  // chessground needs the legal destinations to accept a drag, and `Board` has no prop for
  // them — it publishes its `Api` for exactly this kind of thing. `configure` deep-merges,
  // so what is written here survives the wrapper's own `set()` calls. Emptying them is also
  // how a preview is made undraggable — see `NO_DESTS`.
  useEffect(() => {
    boardApi.current?.set({
      movable: { free: false, showDests: true, dests: previewLine ? NO_DESTS : line.dests },
    })
  }, [line.dests, previewLine])

  const back = useCallback(() => {
    if (line.steps.length === 0) return
    // `truncateTo` takes an absolute ply, and `line.ply` is where the *next* move would go.
    setLine(truncateTo(line, line.ply - 1), { remember: false })
  }, [line, setLine])

  const forward = useCallback(() => {
    const remembered = trail.current
    const current = line.steps.map((step) => step.uci)
    const continues =
      remembered.length > current.length &&
      current.every((uci, index) => remembered[index] === uci)
    if (!continues) return
    setLine(remembered.slice(0, current.length + 1), { remember: false })
  }, [line, setLine])

  const play = useCallback(
    (uci: string) => {
      const next = withMove(line, uci.slice(0, 2), uci.slice(2, 4))
      if (next) setLine(next)
    },
    [line, setLine],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A modifier makes an arrow the browser's own command — ⌘← / alt+← is history-back,
      // and walking the line as well would fight the history entry the router just wrote.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isTyping(event.target)) return
      if (event.key === 'ArrowLeft') back()
      if (event.key === 'ArrowRight') forward()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [back, forward])

  // The vendored book first, the owner's own ECO tags second. The book names a position
  // whether or not anyone has played it, which is most of the tree; `commonOpening` still
  // answers where the book runs out — and it is what `openLibrary` takes its ECO from, since
  // that filter searches the tags the games actually carry.
  const tagged = useMemo(() => commonOpening(occurrences.data ?? []), [occurrences.data])
  // Both books name a position, and on a reference source the name has to come from the
  // one being read: `tree` was never asked, and the owner's own ECO tags describe games
  // that have nothing to do with the database on screen.
  const booked = (reference ? book.data?.opening : tree.data?.opening) ?? null
  const opening = booked ?? (reference ? null : tagged)
  const orientation = flipped ? (scope === 'black' ? 'white' : 'black') : (scope ?? 'white')
  const totalGames = (tree.data?.totals.games as number | undefined) ?? 0

  // Deliberately the tagged code and not the book's: `/games?eco=` filters on the codes the
  // owner's own games carry, and a book code none of them was tagged with lands on an empty
  // library page.
  const openLibrary = useMemo(() => {
    const eco = tagged?.eco
    if (!eco) return null
    return () => {
      const query = new URLSearchParams({ eco })
      if (scope) query.set('color', scope)
      navigate(`/games?${query.toString()}`)
    }
  }, [tagged?.eco, scope, navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetPageChrome breadcrumb={[{ label: 'Explorer', to: '/explorer' }]} />

      {/*
        Below `md` the two panels become one column that scrolls as a whole: the board and
        its controls first, the tree under them. The desktop layout is two panes that never
        scroll together — the tree scrolls inside itself against a fixed board — and on a
        phone that would be a 460px board over a 200px scroller, so the outer row takes the
        scrolling and both panes go back to normal flow.
      */}
      <div className="flex min-h-0 flex-1 gap-[1.125rem] overflow-hidden px-5 py-[1.125rem] max-md:flex-col max-md:gap-3 max-md:overflow-y-auto max-md:px-3 max-md:py-3">
        <div className="flex w-[31.25rem] flex-none flex-col gap-3.5 max-md:w-full">
          <div className="flex flex-col gap-[0.4375rem]">
            <div className="flex items-baseline gap-2">
              <h1 className="text-[0.9375rem] font-semibold text-ink">
                {opening?.name ?? (line.steps.length === 0 ? 'The initial position' : 'This line')}
              </h1>
              {opening?.eco ? (
                <span className="font-mono text-[0.6875rem] text-dim">{opening.eco}</span>
              ) : null}
            </div>
            <LineBreadcrumb
              steps={line.steps}
              onTruncate={(ply) => setLine(truncateTo(line, ply), { remember: false })}
            />
          </div>

          <Board
            fen={previewLine?.fen ?? line.fen}
            orientation={orientation}
            lastMove={previewLine?.lastMove ?? line.lastMove}
            turnColor={previewLine?.turn ?? line.turn}
            // Never `viewOnly` for the preview — see the `dests` effect above. A drag
            // while one is showing is stopped by emptying the destinations instead.
            viewOnly={false}
            onMove={(orig, dest) => {
              const next = withMove(line, orig, dest)
              if (next) setLine(next)
              // Nothing was played, so put the piece back where the FEN says it is.
              else boardApi.current?.set({ fen: line.fen })
            }}
            className="w-[28.75rem] max-md:w-full"
            ref={boardApi}
          />

          <div className="flex items-center gap-2.5 max-md:flex-wrap">
            <div className="flex overflow-hidden rounded-md border border-edge bg-elevated">
              <button
                type="button"
                aria-label="Back one move"
                onClick={back}
                disabled={line.steps.length === 0}
                className="border-r border-edge px-2.5 py-1 text-xs text-soft transition-colors hover:bg-selected hover:text-ink disabled:text-faint-2 disabled:hover:bg-transparent"
              >
                ◀
              </button>
              <button
                type="button"
                aria-label="Forward one move"
                onClick={forward}
                className="px-2.5 py-1 text-xs text-soft transition-colors hover:bg-selected hover:text-ink"
              >
                ▶
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFlipped((current) => !current)}
              className="rounded-md border border-edge bg-elevated px-2.5 py-1 text-xs text-soft transition-colors hover:text-ink"
            >
              ⇅ Flip
            </button>
            {line.steps.length > 0 ? (
              <button
                type="button"
                onClick={() => setLine([])}
                className="rounded-md border border-edge bg-elevated px-2.5 py-1 text-xs text-soft transition-colors hover:text-ink"
              >
                Reset
              </button>
            ) : null}
            {/*
              In the board's own control row, exactly where the game screen puts "← Back to
              explorer" for a game opened from here: the two doors between these screens are
              one feature and they sit in the same place on both sides of it.
            */}
            {backToGame ? (
              <Link
                to={backToGame}
                className="rounded-md border border-brilliant/30 bg-brilliant/10 px-2.5 py-1 text-xs text-brilliant transition-colors hover:border-brilliant/50"
              >
                ← Back to game
              </Link>
            ) : null}
            <div className="flex-1" />
            <span className="font-mono text-[0.6875rem] tabular text-dim">
              {line.turn} to move · ply {line.ply}
            </span>
          </div>

          {/*
            Under the board rather than in the tree pane: a note is about the position on
            the board, and it is written while looking at it. It also keeps the right pane
            to one thing — the tree and the games under it — which is what makes the tree's
            ten-row cap enough to hold everything below the table still.
          */}
          <PositionNotes fen={line.fen} />

          {/* The owner's results in this line — there is no reference equivalent. */}
          {reference ? null : (
            <LineSummary tree={tree.data} ply={line.ply} loading={tree.isPending} />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto max-md:flex-none max-md:overflow-visible">
          <div className="flex flex-none flex-col gap-1.5">
            <div className="flex items-center gap-2.5 max-md:flex-wrap">
              <span className="text-[0.75rem] font-semibold text-ink">
                {source === 'mine'
                  ? 'Your move tree from here'
                  : source === 'masters'
                    ? 'What masters play from here'
                    : 'What lichess plays from here'}
              </span>
            </div>
            {/*
              Leading the pane rather than trailing the title, because the two controls
              decide what every number below them means — which book is open, and which of
              the owner's colours count. The scope is a statement about the owner's games,
              so a reference source disables it rather than hiding it: the answer is
              "not applicable", not "gone", and the table below never jumps.
            */}
            <div className="flex items-center gap-2 max-md:flex-wrap">
              <SourceToggle
                source={source}
                onChange={(next) => setLens('source', next === 'mine' ? null : next)}
              />
              <ScopeToggle scope={scope} onChange={setScope} disabled={reference} />
            </div>
            {source === 'lichess' ? (
              <ReferenceFilters
                speeds={speeds}
                ratings={ratings}
                onSpeeds={(next: Speed[]) => setLens('speeds', formatCsv(next))}
                onRatings={(next: number[]) => setLens('ratings', formatCsv(next))}
              />
            ) : null}
          </div>

          {reference ? (
            tokenReason ? (
              <ReferenceTokenCard reason={tokenReason} />
            ) : book.isError ? (
              <Failure
                title="Could not read that database"
                message={book.error?.message ?? 'Lichess did not answer.'}
                onRetry={() => void book.refetch()}
              />
            ) : (
              <>
                <ReferenceMoveTable
                  data={book.data}
                  ply={line.ply}
                  loading={book.isPending}
                  onPlay={(move) => play(move.uci)}
                  onPreview={onPreview}
                />

                <ModelGames
                  source={source}
                  games={book.data?.top_games ?? []}
                  loading={book.isPending}
                />
              </>
            )
          ) : tree.isError ? (
            <Failure
              title="Could not read the tree"
              message={tree.error?.message ?? 'The backend did not answer.'}
              onRetry={() => void tree.refetch()}
            />
          ) : (
            <>
              <MoveTreeTable
                tree={tree.data}
                ply={line.ply}
                loading={tree.isPending}
                onPlay={(move: ExplorerMove) => play(move.uci)}
                onPreview={onPreview}
              />

              <GamesInLine
                games={occurrences.data ?? []}
                loading={occurrences.isPending}
                total={totalGames}
                onOpenLibrary={openLibrary}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Which book the page is reading — design 2c's source control, at last with three
 * sources to offer.
 *
 * It leads the tree pane, left-aligned above the table with the colour scope beside it,
 * a step larger than an ordinary chip — it changes what every number below it means, so
 * it has to be found before the table is read. `mine` clears the param instead of
 * writing `source=mine`, so the page's own URL stays the short one it has always been.
 */
function SourceToggle({
  source,
  onChange,
}: {
  source: ExplorerSource
  onChange: (next: ExplorerSource) => void
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-edge bg-elevated font-mono text-[0.75rem]">
      {SOURCES.map((option, index) => (
        <button
          key={option}
          type="button"
          aria-pressed={source === option}
          onClick={() => onChange(option)}
          className={cn(
            'px-3 py-1.5 transition-colors',
            index > 0 && 'border-l border-edge',
            source === option ? 'bg-selected text-ink' : 'text-dim hover:text-ink',
          )}
        >
          {SOURCE_LABELS[option]}
        </button>
      ))}
    </div>
  )
}

/** A pane that could not be read, with the one thing worth offering: ask again. */
function Failure({
  title,
  message,
  onRetry,
}: {
  title: string
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-xl border border-blunder/28 bg-blunder/5 p-5">
      <span className="text-[0.75rem] font-semibold text-blunder">{title}</span>
      <p className="text-[0.78125rem] leading-relaxed text-soft">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
      >
        Try again
      </button>
    </div>
  )
}

/**
 * Which colour's games count — the one scope `/explorer` really takes. Disabled, not
 * hidden, on a reference source: the question only makes sense of the owner's own games,
 * and keeping the inert control in place says so without reflowing the pane.
 */
function ScopeToggle({
  scope,
  onChange,
  disabled = false,
}: {
  scope: Color | undefined
  onChange: (next: Color | undefined) => void
  disabled?: boolean
}) {
  const options: { label: string; value: Color | undefined }[] = [
    { label: 'both', value: undefined },
    { label: 'as white', value: 'white' },
    { label: 'as black', value: 'black' },
  ]
  return (
    <div
      className={cn(
        'flex overflow-hidden rounded-md border border-edge bg-elevated font-mono text-[0.75rem]',
        disabled && 'opacity-40',
      )}
    >
      {options.map((option, index) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={!disabled && scope === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-3 py-1.5 transition-colors',
            index > 0 && 'border-l border-edge',
            !disabled && scope === option.value ? 'bg-selected text-ink' : 'text-dim',
            !disabled && scope !== option.value && 'hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
