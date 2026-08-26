/**
 * The leave-book indicator — design 2c's amber-edged "where this line goes wrong" card.
 *
 * "Book" here is the owner's own book: `services.explorer.book_walk` follows the most-played
 * continuation while it repeats and stops at the first move played in a single game. So the
 * card says how deep the repertoire actually goes and what the first improvisation is.
 */
import type { ExplorerResponse } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { plyLabel } from '../line'
import { bookReason } from '../stats'

interface BookMove {
  ply?: number
  uci?: string
  san?: string
  games?: number
}

export function BookCard({
  tree,
  rootPly,
  onFollow,
}: {
  tree: ExplorerResponse
  /** The ply the first continuation from this position occupies. */
  rootPly: number
  /** Replay the whole book line from here. */
  onFollow: (ucis: string[]) => void
}) {
  const depth = tree.book_depth ?? 0
  const leaves = (tree.leaves_book_with ?? null) as BookMove | null
  const line = (tree.main_line ?? []) as BookMove[]
  const inBook = depth > 0
  const followable = line.slice(0, depth).map((step) => step.uci ?? '')

  return (
    <div
      className={cn(
        'flex flex-col gap-[0.4375rem] rounded-[0.5625rem] border border-line bg-panel p-3.5 border-l-2',
        inBook ? 'border-l-accent-teal' : 'border-l-mistake',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[0.75rem] font-semibold text-ink">
          {inBook ? 'Where you leave your book' : 'You are already out of book'}
        </span>
        <div className="flex-1" />
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-edge px-1.5 py-px font-mono text-[0.625rem] text-soft">
          book depth
          <span className={cn('tabular', inBook ? 'text-accent-teal' : 'text-mistake')}>
            {depth}
          </span>
        </span>
      </div>

      <p className="text-[0.78125rem] leading-relaxed text-body-2">
        {inBook ? (
          <>
            From here you repeat yourself for{' '}
            <span className="font-mono text-ink">{depth}</span>{' '}
            {depth === 1 ? 'move' : 'moves'}
            {leaves?.san ? (
              <>
                {' '}
                and then improvise with{' '}
                <span className="font-mono text-ink">
                  {plyLabel(rootPly + (leaves.ply ?? depth))}
                  {leaves.san}
                </span>
              </>
            ) : null}
            . The walk stopped because {bookReason(tree.leaves_book_because)}.
          </>
        ) : (
          <>
            No continuation from this position has been played more than once — the walk
            stopped because {bookReason(tree.leaves_book_because)}.
          </>
        )}
      </p>

      {inBook && followable.every(Boolean) ? (
        <button
          type="button"
          onClick={() => onFollow(followable)}
          className="self-start text-[0.71875rem] text-accent-teal hover:text-accent-link"
        >
          Follow the book line →
        </button>
      ) : null}
    </div>
  )
}
