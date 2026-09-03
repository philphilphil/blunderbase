/**
 * The way back to where the game was opened from, and — for a model game out of one of the
 * reference books — the one door through the wall between those books and the library.
 *
 * These lived in the titlebar, at the far end of a strip the reader's eye never goes to
 * while a game is being read: the whole screen below it is board and moves, and a reader
 * three plies into a model game had no way of knowing the door was there at all. They ride
 * in the board's control row now, as one more group in the band that says what to do to the
 * game — beside the analysis tiers and Note, which are the same kind of decision, and within
 * a hand's reach of the board they are about.
 *
 * A component rather than a node built inside `GamePage` because it holds a react-query
 * mutation: the studio re-renders on every engine tick, and the pending and error states of
 * "Add to library" belong to the button rather than to the page that places it.
 */
import { Link, useNavigate } from 'react-router-dom'

import { useImportReferenceGame } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import type { StudioGame } from '../GamePage'

/** The board row's button metrics — shared with everything else in that band. */
const BUTTON = 'flex-none rounded-md border px-2.5 py-[0.3125rem] text-xs max-md:py-1.5'

export function StudioActions({
  game,
  /** The explorer position this was opened from, or null where it was not. */
  backTo,
}: {
  game: StudioGame
  backTo: string | null
}) {
  if (game.kind === 'library' && !backTo) return null
  return (
    // A group of its own, so the row wraps it whole rather than splitting the door from the
    // way back — the same rule every other group in that row is built on.
    <div className="flex flex-none items-center gap-2 max-md:gap-1.5">
      {game.kind === 'reference' ? (
        <AddToLibrary source={game.source} id={game.id} backTo={backTo} />
      ) : null}
      {backTo ? (
        <Link
          to={backTo}
          className={cn(BUTTON, 'border-edge bg-elevated text-soft hover:text-ink')}
        >
          ← Back to explorer
        </Link>
      ) : null}
    </div>
  )
}

/**
 * "Add to library" — the deliberate act that turns a model game into a row.
 *
 * A model game is fetched, read and forgotten; nothing else on the screen writes it
 * anywhere. This stores it as a game the owner did not play (`is_owner_game` off, so it
 * counts in nothing), which queues its quick pass, and then goes to the real game at its own
 * id — carrying the explorer position along, so the way back does not become the way back to
 * the explorer's start. `replace`, because the reference URL is now a worse copy of the page
 * the reader is on and the browser's Back should skip it.
 */
function AddToLibrary({
  source,
  id,
  backTo,
}: {
  source: 'masters' | 'lichess'
  id: string
  backTo: string | null
}) {
  const navigate = useNavigate()
  const add = useImportReferenceGame({
    onSuccess: (result) =>
      navigate(`/games/${result.game.id}`, {
        state: backTo ? { from: backTo } : undefined,
        replace: true,
      }),
  })

  return (
    <button
      type="button"
      onClick={() => add.mutate({ source, gameId: id })}
      disabled={add.isPending}
      title={
        add.error?.message ??
        'Kept as somebody else’s game: analysed and annotated like your own, counted in no statistic.'
      }
      // Teal-tinted, the row's vocabulary for the one control that is doing something rather
      // than showing something. It is the only affirmative act on a model game's screen.
      className={cn(
        BUTTON,
        add.isError
          ? 'border-blunder/40 bg-blunder/10 text-blunder'
          : 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal hover:border-accent-teal/50',
      )}
    >
      {add.isPending ? 'Adding…' : add.isError ? 'Could not add — retry' : '+ Add to library'}
    </button>
  )
}
