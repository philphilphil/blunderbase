/**
 * `/correspondence` — every game the owner is playing over weeks, in three sections.
 *
 * **Your move**, sorted by due date, is the whole reason the screen exists: it is the list
 * of what has to be answered and by when. **Waiting for the opponent** is the same rows with
 * the clock running the other way, and **Finished** is the last few, each a link into the
 * library — a finished correspondence game is a library game like any other, and this page
 * is not a second place to read one.
 *
 * The sections are a client-side split of one ordering rather than three calls: the backend
 * sends the list already sorted (`format.ts`'s `sections`), so the page decides which
 * heading a row falls under and nothing else.
 *
 * The capacity strip under the heading is a placeholder in this step. Step 2 of
 * `docs/correspondence.md` brings the searches that make it say something — slots in use,
 * parked engines, hosts — and until there is a worker behind it, it says what the mode can
 * and cannot do yet rather than four zeroes pretending to be a readout.
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { ArrowRight, FileText, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import { Section } from '@/components/shell/Section'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useCorrespondenceGames,
  useCreateCorrespondenceGame,
  useImportCorrespondenceGame,
} from '@/lib/api/queries'
import type { CorrespondenceGameSummary } from '@/lib/api/types'
import { useNotation } from '@/lib/chess/notationPrefs'
import { formatScore } from '@/lib/chess/evaluation'
import { cn } from '@/lib/utils'

import { ImportPgnDialog, NewGameDialog } from './components/NewGameDialog'
import {
  duePhrase,
  dueTone,
  iccfNumber,
  opponentOf,
  opponentRating,
  ownerColor,
  sections,
  shortDate,
} from './format'

const DUE_CLASS: Record<string, string> = {
  late: 'text-blunder',
  soon: 'text-mistake',
  calm: 'text-body',
  none: 'text-dim',
}

/** The owner's colour as the dot the rows are read by. */
function Side({ color }: { color: 'white' | 'black' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 flex-none rounded-full border align-[-0.0625rem]',
        color === 'white'
          ? 'border-side-white-edge bg-side-white'
          : 'border-side-black-edge bg-side-black',
      )}
    />
  )
}

function Due({ game }: { game: CorrespondenceGameSummary }) {
  const { i18n } = useLingui()
  const tone = dueTone(game)
  const phrase = duePhrase(game.days_left)
  if (!phrase) return <span className="text-[0.6875rem] text-dim">—</span>
  return (
    <span className="flex flex-col">
      <span className={cn('text-[0.75rem]', DUE_CLASS[tone])}>
        {i18n._({ ...phrase.message, values: phrase.values })}
      </span>
      <span className="mt-px font-mono text-[0.625rem] text-dim-2">
        {shortDate(game.reply_due, i18n.locale)}
      </span>
    </span>
  )
}

/**
 * One engine chip per search on the game. In this step the list is always empty — nothing
 * creates a search yet — so the column simply prints nothing rather than a placeholder.
 */
function EngineChips({ game }: { game: CorrespondenceGameSummary }) {
  const searches = game.searches ?? []
  if (searches.length === 0) return null
  return (
    <span className="flex flex-wrap gap-1">
      {searches.map((search) => (
        <span
          key={search.id}
          className="inline-flex items-center gap-1.5 rounded-sm border border-edge px-1.5 py-px font-mono text-[0.625rem] text-body"
        >
          <span
            aria-hidden
            className={cn(
              'size-[0.3125rem] rounded-full',
              search.status === 'running'
                ? 'bg-good'
                : search.status === 'paused'
                  ? 'bg-mistake'
                  : 'bg-accent-teal',
            )}
          />
          {search.engine_name ?? '—'}
        </span>
      ))}
    </span>
  )
}

function OngoingRow({ game }: { game: CorrespondenceGameSummary }) {
  const { t } = useLingui()
  const notate = useNotation()
  const navigate = useNavigate()
  const number = iccfNumber(game)
  const rating = opponentRating(game)
  const last = game.last_move_san ? notate(game.last_move_san) : null
  return (
    <tr
      className="cursor-pointer border-t border-hairline hover:bg-raised"
      onClick={() => void navigate(`/correspondence/${game.game_id}`)}
    >
      <td className="py-2 pr-3 align-middle">
        <Link
          to={`/correspondence/${game.game_id}`}
          className="flex items-center gap-2 text-[0.78125rem] font-medium text-ink hover:text-accent-link"
          onClick={(event) => event.stopPropagation()}
        >
          <Side color={ownerColor(game)} />
          <span className="truncate">{opponentOf(game)}</span>
          {rating ? <span className="font-mono text-[0.625rem] text-dim">{rating}</span> : null}
        </Link>
        <span className="mt-0.5 block text-[0.625rem] text-dim">
          {[game.event, number ? t`ICCF ${number}` : null].filter(Boolean).join(' · ') || '—'}
        </span>
      </td>
      <td className="py-2 pr-3 align-middle">
        <span className="font-mono text-[0.71875rem] text-body">
          {last ? t`after ${last}` : t`no moves yet`}
        </span>
        <span className="mt-0.5 block text-[0.625rem] text-dim">
          {game.to_move === 'white'
            ? t`move ${game.move_number}, White to play`
            : t`move ${game.move_number}, Black to play`}
        </span>
      </td>
      <td className="py-2 pr-3 align-middle">
        <Due game={game} />
      </td>
      <td className="py-2 pr-3 align-middle">
        <EngineChips game={game} />
      </td>
      <td className="py-2 text-right align-middle font-mono text-[0.75rem] font-semibold text-body">
        {formatScore(game.root_eval ?? null)}
      </td>
    </tr>
  )
}

function OngoingTable({
  games,
  dueHeading,
}: {
  games: CorrespondenceGameSummary[]
  dueHeading: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-[0.625rem] tracking-[0.1em] text-faint uppercase">
            <th className="w-[38%] py-1.5 pr-3 text-left font-normal">
              <Trans>Game</Trans>
            </th>
            <th className="py-1.5 pr-3 text-left font-normal">
              <Trans>Position</Trans>
            </th>
            <th className="py-1.5 pr-3 text-left font-normal">{dueHeading}</th>
            <th className="py-1.5 pr-3 text-left font-normal">
              <Trans>Engines</Trans>
            </th>
            <th className="py-1.5 text-right font-normal">
              <Trans>Root</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <OngoingRow key={game.game_id} game={game} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Finished games link into the library: that is where a finished game is read. */
function FinishedRow({ game }: { game: CorrespondenceGameSummary }) {
  const { i18n } = useLingui()
  const date = shortDate(game.last_move_at ?? game.updated_at, i18n.locale)
  return (
    <div className="flex items-center gap-3 border-t border-hairline py-2">
      <Side color={ownerColor(game)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.78125rem] font-medium text-ink">
          {opponentOf(game)}
        </span>
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[0.625rem] text-dim">
          {game.event ? <span>{game.event} ·</span> : null}
          <span className="font-mono">{game.result}</span>
          <span>
            ·{' '}
            <Plural value={Math.ceil(game.ply_count / 2)} one="1 move" other="# moves" />
          </span>
          {date ? <span>· {date}</span> : null}
        </span>
      </span>
      <Link
        to={`/games/${game.game_id}`}
        className="inline-flex items-center gap-1 text-[0.6875rem] text-accent-teal hover:text-accent-link"
      >
        <Trans>Open in Games</Trans>
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-[0.75rem] text-dim">{children}</p>
}

export function CorrespondencePage() {
  const { t } = useLingui()
  const navigate = useNavigate()
  const games = useCorrespondenceGames()
  const [dialog, setDialog] = useState<'new' | 'import' | null>(null)

  const opened = (gameId: number) => {
    setDialog(null)
    void navigate(`/correspondence/${gameId}`)
  }
  const create = useCreateCorrespondenceGame({
    onSuccess: (detail) => opened(detail.game.game_id),
  })
  const importPgn = useImportCorrespondenceGame({
    onSuccess: (detail) => opened(detail.game.game_id),
  })

  const cut = sections(games.data?.games ?? [])
  const counts = games.data?.counts ?? {}
  const ongoing = counts.ongoing ?? cut.yourMove.length + cut.waiting.length

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: t`Correspondence` }]} manual="guide/correspondence" />
      <PageHeader
        title={t`Correspondence`}
        description={
          <Plural
            value={ongoing}
            _0="No games running"
            one="1 game running"
            other="# games running"
          />
        }
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog('import')}>
              <FileText aria-hidden />
              <Trans>Import PGN</Trans>
            </Button>
            <Button type="button" onClick={() => setDialog('new')}>
              <Plus aria-hidden />
              <Trans>New game</Trans>
            </Button>
          </div>
        }
      />

      {/*
        The capacity strip. Empty of numbers until there is a worker to report any: step 2
        fills it with slots in use, parked engines and hosts. It keeps its place now so the
        page does not rearrange itself when that lands.
      */}
      <div
        data-testid="correspondence-capacity"
        className="flex flex-wrap gap-x-6 gap-y-1.5 border-y border-hairline py-2 text-[0.6875rem] text-dim"
      >
        <span>
          <Trans>No engine is searching a correspondence position yet.</Trans>
        </span>
        <span className="text-dim-2">
          <Trans>Searches, tasks and the capacity they use arrive in the next step.</Trans>
        </span>
      </div>

      {games.isPending ? <Skeleton className="h-24 w-full" data-testid="correspondence-loading" /> : null}
      {games.error ? (
        <div className="rounded-md border border-blunder/28 bg-blunder/5 px-3 py-2.5">
          <p className="text-[0.75rem] text-blunder">
            <Trans>The correspondence games could not be read.</Trans>
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] text-blunder/80">{games.error.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2.5"
            onClick={() => void games.refetch()}
          >
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : null}

      {games.data ? (
        <>
          <Section
            title={<Trans>Your move</Trans>}
            detail={t`by due date`}
            end={<span className="font-mono text-[0.6875rem] text-dim">{cut.yourMove.length}</span>}
          >
            {cut.yourMove.length === 0 ? (
              <Empty>
                <Trans>Nothing is waiting on you.</Trans>
              </Empty>
            ) : (
              <OngoingTable games={cut.yourMove} dueHeading={t`Due`} />
            )}
          </Section>

          <Section
            title={<Trans>Waiting for the opponent</Trans>}
            end={<span className="font-mono text-[0.6875rem] text-dim">{cut.waiting.length}</span>}
          >
            {cut.waiting.length === 0 ? (
              <Empty>
                <Trans>No move of yours is out with an opponent.</Trans>
              </Empty>
            ) : (
              <OngoingTable games={cut.waiting} dueHeading={t`Sent`} />
            )}
          </Section>

          <Section title={<Trans>Finished</Trans>} detail={t`in the library now`}>
            {cut.finished.length === 0 ? (
              <Empty>
                <Trans>No correspondence game has finished yet.</Trans>
              </Empty>
            ) : (
              cut.finished
                .slice(0, 6)
                .map((game) => <FinishedRow key={game.game_id} game={game} />)
            )}
          </Section>
        </>
      ) : null}

      {dialog === 'new' ? (
        <NewGameDialog
          pending={create.isPending}
          error={create.error?.message ?? null}
          onCreate={(body) => create.mutate(body)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'import' ? (
        <ImportPgnDialog
          pending={importPgn.isPending}
          error={importPgn.error?.message ?? null}
          onImport={(body) => importPgn.mutate(body)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </PageBody>
  )
}
