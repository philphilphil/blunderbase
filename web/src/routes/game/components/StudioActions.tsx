/**
 * What the studio pins into the titlebar: the way back to where the game was opened from,
 * and — for a model game out of one of the reference books — the one door through the wall
 * between those books and the library.
 *
 * A component rather than a node built inside `GamePage` for one concrete reason. The
 * titlebar is filled through `SetPageChrome`, whose effect keys off the *identity* of the
 * node it is handed; the studio re-renders on every engine tick, so a node rebuilt from a
 * react-query mutation result — which is a fresh object each render — would republish the
 * chrome on every one of those ticks, and the provider's own `setState` would feed straight
 * back into the next render. Holding the mutation in here keeps the element's identity
 * dependent only on the game and the way back, both of which are stable.
 */
import { Link, useNavigate } from 'react-router-dom'

import { useImportReferenceGame } from '@/lib/api/queries'
import { cn } from '@/lib/utils'

import type { StudioGame } from '../GamePage'

const LINK =
  'rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] font-semibold text-accent-teal hover:border-edge-hover hover:text-accent-link'

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
    <div className="flex items-center gap-2">
      {game.kind === 'reference' ? (
        <AddToLibrary source={game.source} id={game.id} backTo={backTo} />
      ) : null}
      {backTo ? (
        <Link to={backTo} className={LINK}>
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
      className={cn(LINK, add.isError && 'border-blunder/40 text-blunder hover:text-blunder')}
    >
      {add.isPending ? 'Adding…' : add.isError ? 'Could not add — retry' : '+ Add to library'}
    </button>
  )
}
