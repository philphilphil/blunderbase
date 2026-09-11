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
import { Trans, useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { SETTING_DEFAULTS } from '@/lib/api/appSettings'
import {
  useAppSettings,
  useCorrespondenceGames,
  useImportReferenceGame,
} from '@/lib/api/queries'
import { CorrespondenceTreeDialog } from '@/routes/correspondence/components/CorrespondenceTreeDialog'
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
  const tree = useCorrespondenceTree(game.kind === 'library' ? game.id : null)
  if (game.kind === 'library' && !backTo && !tree.has) return null
  return (
    // A group of its own, so the row wraps it whole rather than splitting the door from the
    // way back — the same rule every other group in that row is built on.
    <div className="flex flex-none items-center gap-2 max-md:gap-1.5">
      {game.kind === 'reference' ? (
        <AddToLibrary source={game.source} id={game.id} backTo={backTo} />
      ) : null}
      {tree.has && game.kind === 'library' ? (
        <CorrespondenceTreeButton gameId={game.id} />
      ) : null}
      {backTo ? (
        <Link
          to={backTo}
          className={cn(BUTTON, 'border-edge bg-elevated text-soft hover:text-ink')}
        >
          <Trans>← Back to explorer</Trans>
        </Link>
      ) : null}
    </div>
  )
}

/**
 * Whether this library game is one the owner played by correspondence, and therefore has a
 * tree behind it.
 *
 * Answered off the correspondence list rather than by asking for the game's tree: that list
 * is one small request the rail has already made, and a per-game probe would be a 404 on
 * every ordinary game anybody opens. Nothing is asked at all while the mode is off.
 */
function useCorrespondenceTree(gameId: number | null): { has: boolean } {
  const settings = useAppSettings()
  const on =
    (settings.data?.correspondence_enabled ?? SETTING_DEFAULTS.correspondence_enabled) === 1
  const games = useCorrespondenceGames(undefined, { enabled: on && gameId !== null })
  return {
    has:
      gameId !== null &&
      (games.data?.games ?? []).some((candidate) => candidate.game_id === gameId),
  }
}

/**
 * The door into the months of work behind a finished correspondence game. Read-only: the
 * tree froze when the game did, and this screen is where the game is read, not where the
 * tree is edited.
 */
function CorrespondenceTreeButton({ gameId }: { gameId: number }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(BUTTON, 'border-edge bg-elevated text-soft hover:text-ink')}
      >
        <Trans>Correspondence tree</Trans>
      </button>
      {open ? (
        <CorrespondenceTreeDialog gameId={gameId} onClose={() => setOpen(false)} />
      ) : null}
    </>
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
  const { t } = useLingui()
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
        t`Kept as somebody else’s game: analysed and annotated like your own, counted in no statistic.`
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
      {add.isPending ? (
        <Trans>Adding…</Trans>
      ) : add.isError ? (
        <Trans>Could not add — retry</Trans>
      ) : (
        <Trans>+ Add to library</Trans>
      )}
    </button>
  )
}
