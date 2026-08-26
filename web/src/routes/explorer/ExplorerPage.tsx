/**
 * Design 2c — the opening explorer.
 *
 * Board on the left, the owner's own tree on the right. `/explorer` is keyed by position,
 * so the line is replayed client-side (`line.ts`) and the resulting FEN is what the endpoint
 * is asked about; the line itself rides in the URL, which makes any position in the tree a
 * link and makes the browser's back button walk the tree backwards for free.
 *
 * Two deliberate departures from the 2c mock:
 *
 * - The board keeps design 1a's *edge* coordinates rather than 2c's three sparse in-square
 *   corner labels. One board component serves every screen, and chessground's in-square
 *   mode (`coordinates="inside"`, design 1b) labels every file and rank rather than three
 *   corners — so 2c's treatment is not available without a third coordinate renderer, and
 *   a board that changes its coordinates per screen reads as two different boards.
 * - 2c's `my games / masters / both` source control is a `both / as white / as black`
 *   colour scope instead. `/explorer` aggregates the owner's own games and nothing else;
 *   there is no masters book in the backend, and a segmented control offering one would be
 *   a control that cannot be switched on.
 */
import type { Api } from '@lichess-org/chessground/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Board } from '@/components/board/Board'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { useExplorer, usePositionOccurrences } from '@/lib/api/queries'
import type { Color, ExplorerMove } from '@/lib/api/types'
import { isTyping } from '@/routes/game/useBoardKeys'
import { cn } from '@/lib/utils'

import { BookCard } from './components/BookCard'
import { GamesInLine } from './components/GamesInLine'
import { LineBreadcrumb } from './components/LineBreadcrumb'
import { LineSummary } from './components/LineSummary'
import { MoveTreeTable } from './components/MoveTreeTable'
import { PositionNotes } from './components/PositionNotes'
import {
  buildLine,
  formatLineParam,
  parseLineParam,
  truncateTo,
  withMove,
} from './line'
import { commonOpening } from './stats'

/** How many continuations and how many games to ask for. */
const MOVE_LIMIT = 24
const GAME_LIMIT = 14

export function ExplorerPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const ucis = useMemo(() => parseLineParam(params.get('line')), [params])
  const scope = (params.get('color') as Color | null) ?? undefined
  const line = useMemo(() => buildLine(ucis), [ucis])

  const [flipped, setFlipped] = useState(false)
  const boardApi = useRef<Api | null>(null)
  // The longest line visited, so "forward" can walk back into what was just undone.
  const trail = useRef<string[]>(ucis)

  const setLine = useCallback(
    (next: readonly string[], { remember = true }: { remember?: boolean } = {}) => {
      if (remember) trail.current = [...next]
      const updated = new URLSearchParams(params)
      if (next.length === 0) updated.delete('line')
      else updated.set('line', formatLineParam(next))
      setParams(updated)
    },
    [params, setParams],
  )

  const setScope = useCallback(
    (next: Color | undefined) => {
      const updated = new URLSearchParams(params)
      if (next) updated.set('color', next)
      else updated.delete('color')
      setParams(updated, { replace: true })
    },
    [params, setParams],
  )

  const tree = useExplorer({ fen: line.fen, color: scope, limit: MOVE_LIMIT })
  const occurrences = usePositionOccurrences(line.fen, { color: scope, limit: GAME_LIMIT })

  // chessground needs the legal destinations to accept a drag, and `Board` has no prop for
  // them — it publishes its `Api` for exactly this kind of thing. `configure` deep-merges,
  // so what is written here survives the wrapper's own `set()` calls.
  useEffect(() => {
    boardApi.current?.set({
      movable: { free: false, showDests: true, dests: line.dests },
    })
  }, [line.dests])

  const back = useCallback(() => {
    if (line.steps.length === 0) return
    setLine(truncateTo(line, line.steps.length - 1), { remember: false })
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

  const opening = useMemo(
    () => commonOpening(occurrences.data ?? []),
    [occurrences.data],
  )
  const orientation = flipped ? (scope === 'black' ? 'white' : 'black') : (scope ?? 'white')
  const totalGames = (tree.data?.totals.games as number | undefined) ?? 0

  const openLibrary = useMemo(() => {
    const eco = opening?.eco
    if (!eco) return null
    return () => {
      const query = new URLSearchParams({ eco })
      if (scope) query.set('color', scope)
      navigate(`/games?${query.toString()}`)
    }
  }, [opening?.eco, scope, navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetPageChrome breadcrumb={[{ label: 'Openings', to: '/explorer' }]} />

      <div className="flex min-h-0 flex-1 gap-[1.125rem] overflow-hidden px-5 py-[1.125rem]">
        <div className="flex w-[31.25rem] flex-none flex-col gap-3.5">
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
            fen={line.fen}
            orientation={orientation}
            lastMove={line.lastMove}
            turnColor={line.turn}
            viewOnly={false}
            onMove={(orig, dest) => {
              const next = withMove(line, orig, dest)
              if (next) setLine(next)
              // Nothing was played, so put the piece back where the FEN says it is.
              else boardApi.current?.set({ fen: line.fen })
            }}
            className="w-[28.75rem]"
            ref={boardApi}
          />

          <div className="flex items-center gap-2.5">
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
            <div className="flex-1" />
            <span className="font-mono text-[0.6875rem] tabular text-dim">
              {line.turn} to move · ply {line.ply}
            </span>
          </div>

          <LineSummary tree={tree.data} ply={line.ply} loading={tree.isPending} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto">
          <div className="flex flex-none items-center gap-2.5">
            <span className="text-[0.75rem] font-semibold text-ink">Your move tree from here</span>
            <div className="flex-1" />
            <ScopeToggle scope={scope} onChange={setScope} />
          </div>

          {tree.isError ? (
            <div className="flex flex-col items-start gap-2.5 rounded-xl border border-blunder/28 bg-blunder/5 p-5">
              <span className="text-[0.75rem] font-semibold text-blunder">
                Could not read the tree
              </span>
              <p className="text-[0.78125rem] leading-relaxed text-soft">
                {tree.error?.message ?? 'The backend did not answer.'}
              </p>
              <button
                type="button"
                onClick={() => void tree.refetch()}
                className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
              >
                Try again
              </button>
            </div>
          ) : (
            <>
              <MoveTreeTable
                tree={tree.data}
                ply={line.ply}
                loading={tree.isPending}
                onPlay={(move: ExplorerMove) => play(move.uci)}
              />

              <PositionNotes fen={line.fen} />

              {tree.data && totalGames > 0 ? (
                <BookCard
                  tree={tree.data}
                  rootPly={line.ply}
                  onFollow={(book) => setLine([...ucis, ...book])}
                />
              ) : null}

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

/** Which colour's games count — the one scope `/explorer` really takes. */
function ScopeToggle({
  scope,
  onChange,
}: {
  scope: Color | undefined
  onChange: (next: Color | undefined) => void
}) {
  const options: { label: string; value: Color | undefined }[] = [
    { label: 'both', value: undefined },
    { label: 'as white', value: 'white' },
    { label: 'as black', value: 'black' },
  ]
  return (
    <div className="flex overflow-hidden rounded-md border border-edge font-mono text-[0.6875rem]">
      {options.map((option, index) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={scope === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-2.5 py-1 transition-colors',
            index > 0 && 'border-l border-edge',
            scope === option.value ? 'bg-selected text-ink' : 'text-dim hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
