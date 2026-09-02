/**
 * A model game from one of the reference books, read-only.
 *
 * It is reached from the explorer's "Model games" list and from nowhere else — it is a leaf
 * rather than a destination, so it has no row in the rail and no entry in the palette. What
 * it exists for is the one thing a table of counts cannot do: show what actually happened
 * after the move, in a game played by somebody who knew the position.
 *
 * **Nothing here is the owner's.** The game is fetched, replayed in the browser and
 * forgotten: no analysis, no notes, no row in the library. That is the wall issue #3 draws
 * between the reference sources and the database, and this page is the far side of it —
 * which is also why it does not reuse `BoardPanel` and `MoveList` from `/games/:id`. Those
 * two are welded to a library game: they want an evaluation per ply, classifications, a
 * run to attach to. A model game has moves and nothing else, and a stripped-down copy of a
 * rich component reads as a broken version of the game view rather than as a different
 * thing.
 *
 * The one door through the wall is "Add to library". It stores the game as one the owner
 * did not play (`is_owner_game` off, so it counts in nothing) and goes straight to the
 * real game view, where the quick pass is already queued and notes can be written. So
 * this page is the preview — one click from the explorer, cheap, and read-only — and the
 * rich view is one more click away rather than reproduced here in a reduced form.
 *
 * The board is replayed client-side from the UCI list with `routes/explorer/line.ts`, the
 * same helper the explorer and the repertoire walk with, so a cursor is just a prefix
 * length and jumping is `slice`. Keys are the explorer's: ←/→ step, guarded by `isTyping`
 * and by the modifier check that leaves ⌘← to the browser's own history.
 */
import { ExternalLink, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

import { Board } from '@/components/board/Board'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useImportReferenceGame, useReferenceGame } from '@/lib/api/queries'
import type { ReferenceGame, ReferenceSource } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { ReferenceTokenCard } from '@/routes/explorer/components/ReferenceTokenCard'
import { buildLine } from '@/routes/explorer/line'
import { parseSource, tokenTrouble } from '@/routes/explorer/reference'
import { formatResult } from '@/routes/games/format'
import { isTyping } from '@/routes/game/useBoardKeys'

export function ReferenceGamePage() {
  const { source: sourceParam, gameId } = useParams<{ source: string; gameId: string }>()
  // `parseSource` answers `mine` for anything that is not one of the two books, which is
  // exactly the check this route needs: a hand-typed `/reference/nonsense/x` is a bad URL,
  // not a request to fetch something.
  const parsed = parseSource(sourceParam ?? null)
  const valid = parsed !== 'mine' && !!gameId
  const source = (parsed === 'mine' ? 'masters' : parsed) as ReferenceSource

  const game = useReferenceGame(source, gameId ?? '', { enabled: valid })

  // The explorer position this was opened from, when `ModelGames` put it in router state;
  // the breadcrumb goes back there rather than to the explorer's start, and so does the
  // library game's "back to explorer" once the game is added. Anything that is not an
  // explorer URL is ignored rather than followed.
  const navigate = useNavigate()
  const location = useLocation()
  const cameFrom = (location.state as { from?: unknown } | null)?.from
  const explorerTo =
    typeof cameFrom === 'string' && cameFrom.startsWith('/explorer') ? cameFrom : '/explorer'
  const add = useImportReferenceGame({
    onSuccess: (result) => navigate(`/games/${result.game.id}`, { state: { from: explorerTo } }),
  })
  // A masters game is fetched from the explorer host with the owner's token, so this page
  // fails the way the explorer's table does when that token is gone or refused — and a
  // "try again" button would fetch the same 409 forever. The explorer's own card is what
  // answers it, because the thing to do about it is the same: paste a new token.
  const tokenReason = tokenTrouble(game.error)

  const ucis = useMemo(() => (game.data?.moves ?? []).map((move) => move.uci), [game.data])
  // How many plies are on the board. The cursor is a length rather than an index so `0` is
  // the initial position and no arithmetic is needed to say "before the first move".
  const [stored, setCursor] = useState(0)
  // Clamped at render rather than reset in an effect: the moves arrive after the first
  // render, so every cursor is briefly ahead of a game of length zero, and a cursor is
  // meaningless in a game shorter than itself. Clamping is total — no frame ever draws a
  // position the game does not have.
  const cursor = Math.min(stored, ucis.length)
  const line = useMemo(() => buildLine(ucis.slice(0, cursor)), [ucis, cursor])

  const seek = useCallback(
    (ply: number) => setCursor(Math.max(0, Math.min(ucis.length, ply))),
    [ucis.length],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isTyping(event.target)) return
      if (event.key === 'ArrowLeft') setCursor((at) => Math.max(0, at - 1))
      if (event.key === 'ArrowRight') setCursor((at) => Math.min(ucis.length, at + 1))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [ucis.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetPageChrome
        breadcrumb={[{ label: 'Explorer', to: explorerTo }, { label: 'Model game' }]}
      />

      <div className="flex min-h-0 flex-1 gap-[1.125rem] overflow-hidden px-5 py-[1.125rem] max-md:flex-col max-md:gap-3 max-md:overflow-y-auto max-md:px-3 max-md:py-3">
        <div className="flex w-[31.25rem] flex-none flex-col gap-3.5 max-md:w-full">
          <GameHeader game={game.data} loading={game.isPending && valid} />

          {valid && !tokenReason ? (
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                onClick={() => gameId && add.mutate({ source, gameId })}
                disabled={!game.data || add.isPending}
                className="self-start"
              >
                <Plus aria-hidden />
                {add.isPending ? 'Adding…' : 'Add to library'}
              </Button>
              {add.isError ? (
                <p className="text-[0.71875rem] text-blunder">
                  {add.error.message || 'The game could not be added.'}
                </p>
              ) : (
                <p className="text-[0.6875rem] text-dim">
                  Kept as somebody else's game: analysed and annotated like your own, counted
                  in no statistic.
                </p>
              )}
            </div>
          ) : null}

          <Board
            fen={line.fen}
            lastMove={line.lastMove}
            turnColor={line.turn}
            className="w-[28.75rem] max-md:w-full"
          />

          <div className="flex items-center gap-2.5 max-md:flex-wrap">
            <div className="flex overflow-hidden rounded-md border border-edge bg-elevated">
              <button
                type="button"
                aria-label="Back to the start"
                onClick={() => seek(0)}
                disabled={cursor === 0}
                className="border-r border-edge px-2.5 py-1 text-xs text-soft transition-colors hover:bg-selected hover:text-ink disabled:text-faint-2 disabled:hover:bg-transparent"
              >
                ⏮
              </button>
              <button
                type="button"
                aria-label="Back one move"
                onClick={() => seek(cursor - 1)}
                disabled={cursor === 0}
                className="border-r border-edge px-2.5 py-1 text-xs text-soft transition-colors hover:bg-selected hover:text-ink disabled:text-faint-2 disabled:hover:bg-transparent"
              >
                ◀
              </button>
              <button
                type="button"
                aria-label="Forward one move"
                onClick={() => seek(cursor + 1)}
                disabled={cursor >= ucis.length}
                className="border-r border-edge px-2.5 py-1 text-xs text-soft transition-colors hover:bg-selected hover:text-ink disabled:text-faint-2 disabled:hover:bg-transparent"
              >
                ▶
              </button>
              <button
                type="button"
                aria-label="Forward to the end"
                onClick={() => seek(ucis.length)}
                disabled={cursor >= ucis.length}
                className="px-2.5 py-1 text-xs text-soft transition-colors hover:bg-selected hover:text-ink disabled:text-faint-2 disabled:hover:bg-transparent"
              >
                ⏭
              </button>
            </div>
            <div className="flex-1" />
            <span className="font-mono text-[0.6875rem] tabular text-dim">
              ply {cursor} of {ucis.length}
            </span>
          </div>

          {game.data?.lichess_url ? (
            <a
              href={game.data.lichess_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-[0.71875rem] text-accent-teal hover:text-accent-link"
            >
              <ExternalLink className="size-3" aria-hidden />
              Open on Lichess
            </a>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto max-md:flex-none max-md:overflow-visible">
          {!valid ? (
            <p className="rounded-[0.5625rem] border border-dashed border-edge-strong px-3 py-8 text-center text-[0.78125rem] text-dim">
              That is not a reference game.
            </p>
          ) : tokenReason ? (
            <ReferenceTokenCard reason={tokenReason} />
          ) : game.isError ? (
            <div className="flex flex-col items-start gap-2.5 rounded-xl border border-blunder/28 bg-blunder/5 p-5">
              <span className="text-[0.75rem] font-semibold text-blunder">
                Could not read that game
              </span>
              <p className="text-[0.78125rem] leading-relaxed text-soft">
                {game.error?.message ?? 'Lichess did not answer.'}
              </p>
              <button
                type="button"
                onClick={() => void game.refetch()}
                className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
              >
                Try again
              </button>
            </div>
          ) : (
            <Movetext
              game={game.data}
              loading={game.isPending}
              cursor={cursor}
              onSeek={seek}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** Who played it, how it ended, and where — the PGN's seven tags, minus the noise. */
function GameHeader({ game, loading }: { game: ReferenceGame | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex flex-col gap-[0.4375rem]">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3 w-40" />
      </div>
    )
  }
  if (!game) return <div className="flex flex-col gap-[0.4375rem]" />

  const rating = (value: number | null | undefined) => (value ? ` (${value})` : '')
  const place = [game.event, game.date].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-[0.4375rem]">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-[0.9375rem] font-semibold text-ink">
          {game.white.name}
          <span className="text-dim">{rating(game.white.rating)}</span>
          <span className="px-1.5 text-faint">vs</span>
          {game.black.name}
          <span className="text-dim">{rating(game.black.rating)}</span>
        </h1>
        <span className="font-mono text-[0.71875rem] tabular text-soft">
          {formatResult(game.result)}
        </span>
      </div>
      {place ? <p className="text-[0.71875rem] text-dim">{place}</p> : null}
    </div>
  )
}

/**
 * The movetext, as the pairs a chess player reads: a move number, White's move, Black's.
 *
 * Two columns rather than one flowing paragraph because this list is also the navigation —
 * every move is a target, and a wrapped paragraph of targets is a paragraph you cannot aim
 * at. The cursor is the ply *count*, so the move highlighted is the one at `cursor - 1`:
 * what is on the board is the position after it.
 */
function Movetext({
  game,
  loading,
  cursor,
  onSeek,
}: {
  game: ReferenceGame | undefined
  loading: boolean
  /** How many plies are on the board. */
  cursor: number
  onSeek: (ply: number) => void
}) {
  const moves = game?.moves ?? []

  if (loading) {
    return (
      <div className="flex flex-col gap-1" data-testid="movetext-loading">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-[1.5rem] rounded-[0.3125rem]" />
        ))}
      </div>
    )
  }

  if (moves.length === 0) {
    return (
      <p className="rounded-[0.5625rem] border border-dashed border-edge-strong px-3 py-8 text-center text-[0.78125rem] text-dim">
        This game has no moves to show.
      </p>
    )
  }

  const pairs: { number: number; white?: (typeof moves)[number]; black?: (typeof moves)[number] }[] =
    []
  for (const move of moves) {
    const number = Math.floor(move.ply / 2) + 1
    const pair = pairs.at(-1)
    if (pair && pair.number === number) pair.black = move
    else pairs.push({ number, [move.ply % 2 === 0 ? 'white' : 'black']: move })
  }

  const cell = (move: (typeof moves)[number] | undefined) => {
    if (!move) return <span className="min-w-0 flex-1" />
    const on = cursor === move.ply + 1
    return (
      <button
        type="button"
        onClick={() => onSeek(move.ply + 1)}
        className={cn(
          'min-w-0 flex-1 truncate rounded-[0.25rem] px-1.5 py-0.5 text-left transition-colors',
          on ? 'bg-selected text-ink' : 'text-body hover:bg-elevated-2 hover:text-ink',
        )}
      >
        {move.san}
      </button>
    )
  }

  return (
    <div
      className="flex flex-col gap-0.5 font-mono text-[0.78125rem] tabular"
      role="list"
      aria-label="Moves"
    >
      {pairs.map((pair) => (
        <div key={pair.number} role="listitem" className="flex items-center gap-1.5">
          <span className="w-8 flex-none text-right text-faint">{pair.number}.</span>
          {cell(pair.white)}
          {cell(pair.black)}
        </div>
      ))}
    </div>
  )
}
