/**
 * What the books say about the selected node — the opening reference, at the position the
 * tree is standing on.
 *
 * A correspondence player in the opening phase is not choosing between three engine lines
 * yet; they are choosing between what theory plays and what their own games have done, and
 * an engine at depth 50 has nothing to say about which of two equal moves has scored. So the
 * same two answers the rest of the app already gives are brought to this node: the **masters**
 * database, which is the reference explorer's, and **your games**, which is the explorer's
 * own tree — the identical query the game screen's Book tab asks, at a FEN rather than a ply.
 *
 * TWO SOURCES, ONE TABLE SHAPE, NEVER BLENDED. The columns differ because the questions do:
 * a masters row reports how the *sides* did (white/draw/black — never green and red, there is
 * no reader in that game), and one of yours reports how *you* did and what it cost you. They
 * are a flip between two tables and never a merge, which is the same rule `/explorer` follows.
 *
 * A row plays its move into the tree, exactly as the board and the candidates table do: the
 * child that is there is walked to, the one that is not is created. Reading theory and
 * keeping what you read are one gesture, which is the only reason this pane is here rather
 * than in another tab of the browser.
 *
 * Masters needs the Lichess token the reference explorer needs, and says so plainly rather
 * than failing: an owner with no token still has their own games, which is the tab that costs
 * nothing and never leaves the machine.
 */
import { Trans, useLingui } from '@lingui/react/macro'

import { Skeleton } from '@/components/ui/skeleton'
import { usePositionBook, useReferenceExplorer, useReferenceToken } from '@/lib/api/queries'
import type { CorrespondenceTreeNode, ReferenceMove } from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'
import { SidesBar } from '@/routes/explorer/components/ScoreBar'
import { formatCount, sharePercent } from '@/routes/explorer/reference'
import { BookPanel } from '@/routes/game/components/BookPanel'

export type BookSource = 'masters' | 'mine'

/** How many continuations are worth reading in a column this narrow. */
const MOVES = 10

/**
 * `58 44 1fr` at the mockup's scale — the move, its count, and the split bar taking what is
 * left. The same first column as `BookPanel` across the divider, so the two tables the tab
 * flips between do not jump.
 */
const GRID = 'grid grid-cols-[3.625rem_2.75rem_minmax(0,1fr)] items-center gap-2'
const ROW = cn(GRID, 'h-[1.625rem] rounded-[0.3125rem] px-1.5 font-mono text-[0.6875rem] tabular')

/**
 * `12.` before a White move, `12…` before a Black one — the tree's own labelling, one move
 * further on.
 *
 * `move_number` is the number of the move *into* this node, and these rows are the move
 * *out* of it: a White continuation therefore belongs to the next number, because the Black
 * move that reached this node closed the one it is counted with. The root has no move into
 * it, so its number is already the number of whatever is played from it — which is also the
 * reason this is not `Math.floor(ply / 2) + 1`: a game entered from a mid-game FEN numbers
 * its moves the way that position does.
 */
function label(node: CorrespondenceTreeNode): string {
  const base = node.move_number ?? 1
  if (node.turn === 'black') return `${base}…`
  return `${node.uci ? base + 1 : base}.`
}

function Masters({
  node,
  onPlay,
  onPreview,
}: {
  node: CorrespondenceTreeNode
  onPlay: (uci: string) => void
  onPreview: (line: string[] | null) => void
}) {
  const { t } = useLingui()
  const notate = useNotation()
  const token = useReferenceToken()
  const enabled = token.data?.configured === true
  const masters = useReferenceExplorer(
    { source: 'masters', fen: node.fen, moves: MOVES, top_games: 0 },
    { enabled },
  )

  if (token.data && !enabled) {
    return (
      <p className="px-3 py-6 text-center text-[0.71875rem] leading-[1.6] text-dim">
        <Trans>
          The masters database is Lichess's, and it needs the token stored under Settings →
          Explorer. Your own games are on the other tab and need nothing.
        </Trans>
      </p>
    )
  }

  if (masters.isPending || token.isPending) {
    return <Skeleton className="mx-1.5 my-2 h-[7rem]" data-testid="correspondence-book-loading" />
  }

  if (masters.error) {
    return (
      <p role="alert" className="px-3 py-6 text-center text-[0.71875rem] text-blunder">
        {masters.error.message}
      </p>
    )
  }

  const moves: ReferenceMove[] = masters.data?.moves ?? []
  const total = masters.data?.totals.games ?? 0
  if (moves.length === 0) {
    return (
      <p
        data-testid="correspondence-book-empty"
        className="px-3 py-6 text-center text-[0.71875rem] text-dim"
      >
        <Trans>The masters database stops here.</Trans>
      </p>
    )
  }

  return (
    <div
      role="table"
      aria-label={t`What the masters play from this position`}
      data-testid="correspondence-book-masters"
      className="flex flex-none flex-col px-1.5 pb-2"
    >
      <div
        role="row"
        className={cn(
          GRID,
          'h-5 border-b border-hairline px-1.5 text-[0.5625rem] tracking-[.06em] text-faint uppercase',
        )}
      >
        <span>
          <Trans>Move</Trans>
        </span>
        <span className="text-right">
          <Trans>Games</Trans>
        </span>
        <span>
          <Trans>White / draw / black</Trans>
        </span>
      </div>
      {moves.map((move) => {
        const share = sharePercent(move.games, total)
        return (
          <button
            key={move.uci}
            type="button"
            role="row"
            onClick={() => onPlay(move.uci)}
            onPointerEnter={() => onPreview([move.uci])}
            onPointerLeave={() => onPreview(null)}
            onFocus={() => onPreview([move.uci])}
            onBlur={() => onPreview(null)}
            title={move.name ?? undefined}
            className={cn(ROW, 'text-left transition-colors hover:bg-elevated')}
          >
            <span className="text-body-3">
              {label(node)}
              {notate(move.san)}
            </span>
            <span className="text-right text-dim" title={share === null ? undefined : `${share}%`}>
              {formatCount(move.games)}
            </span>
            <SidesBar
              white={move.white}
              draws={move.draws}
              black={move.black}
              className="w-full"
              height="0.9375rem"
            />
          </button>
        )
      })}
    </div>
  )
}

function Mine({
  node,
  onPlay,
  onPreview,
}: {
  node: CorrespondenceTreeNode
  onPlay: (uci: string) => void
  onPreview: (line: string[] | null) => void
}) {
  const book = usePositionBook(node.fen)
  if (book.isPending) {
    return <Skeleton className="mx-1.5 my-2 h-[7rem]" data-testid="correspondence-book-loading" />
  }
  return (
    <BookPanel
      moves={book.data?.moves ?? []}
      ply={node.ply}
      onPlay={(move) => onPlay(move.uci)}
      onPreview={onPreview}
    />
  )
}

export function BookPane({
  node,
  source,
  onSourceChange,
  onPlay,
  onPreview,
}: {
  node: CorrespondenceTreeNode
  source: BookSource
  onSourceChange: (source: BookSource) => void
  /** Walk to the child that move reaches, creating it when the tree has not been there. */
  onPlay: (uci: string) => void
  /** Draw a continuation on the board without selecting it; `null` puts the node back. */
  onPreview: (line: string[] | null) => void
}) {
  const { t } = useLingui()
  const sources: { key: BookSource; label: string }[] = [
    { key: 'masters', label: t`Masters` },
    { key: 'mine', label: t`Your games` },
  ]

  return (
    <div className="flex min-h-0 flex-col">
      <div
        role="group"
        aria-label={t`Which book`}
        className="flex flex-none items-center gap-1 border-b border-hairline px-2.5 py-1.5"
      >
        {sources.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={source === entry.key}
            onClick={() => onSourceChange(entry.key)}
            className={cn(
              'rounded-md border px-2 py-px text-[0.625rem] transition-colors',
              source === entry.key
                ? 'border-accent-teal/40 bg-selected text-ink'
                : 'border-edge text-soft hover:border-edge-hover hover:text-ink',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {source === 'masters' ? (
          <Masters node={node} onPlay={onPlay} onPreview={onPreview} />
        ) : (
          <Mine node={node} onPlay={onPlay} onPreview={onPreview} />
        )}
      </div>
    </div>
  )
}
