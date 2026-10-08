/**
 * The Collections screen: every collection the owner keeps, seen at a glance — its colour
 * and name, what it is for, how the owner's games in it went, and the rule that keeps
 * filling it.
 *
 * A screen of its own rather than a mode of the games list, because a collection is a
 * thing with a record — "how is the league season going?" — and the games list is the whole
 * library, where a collection is only one more filter. So a collection leads *into* the
 * library with that filter set (`collectionPath`: every game in it, as its count says), and
 * nothing here suggests the games live here or move between collections: a game can be in
 * several at once, and each only says how many it holds.
 *
 * **Two views, and the reader picks**, with the same switch the notes have (`ViewToggle`,
 * remembered per browser in `./viewMode`): a grid of cards, the shelf a handful reads best
 * as, and a table of rows for when there are enough to compare down a column. Both draw
 * the same figures (`figuresOf`) in the same order.
 *
 * Every card has the same slots in the same places whatever it holds — one line of
 * description, the four figures, the rule line, the footer — so two cards side by side
 * line up row for row. A slot with nothing in it keeps its room: no description is a blank
 * line, a number not there yet is a dash, no rule says the collection is filled by hand.
 * Cards that each took their own shape made a shelf where nothing lined up.
 *
 * The whole card, and the whole row, is the link (its name is stretched over it) because
 * opening the games is what it is for; Edit and Stats are lifted above that link. The score
 * is the owner's side of the board only (`CollectionSummary`), so it can count fewer games
 * than the collection holds — a reference game put in by hand, or one of theirs whose side
 * is not known yet — and says so on hover.
 *
 * "New collection…" is in one place at a time (the control grammar's one command, one
 * home): the bar, while there are collections or they are still loading; the empty shelf's
 * own filled button when there are none, and then not in the bar as well, where it had been
 * two equal doors to the same dialog one above the other.
 */
import { msg, plural } from '@lingui/core/macro'
import { Plural, Trans, useLingui } from '@lingui/react/macro'
import { BarChart3, LayoutGrid, Pencil, Plus, Table2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { CollectionSwatch } from '@/components/collections/CollectionChip'
import { RuleChips } from '@/components/collections/RuleChips'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody } from '@/components/shell/PageHeader'
import { Button } from '@/components/ui/button'
import { COLUMN_HEAD, ROW } from '@/components/ui/row'
import { ViewToggle, type ViewOption } from '@/components/ui/view-toggle'
import { useCollectionOverview } from '@/lib/api/queries'
import type { CollectionDetail } from '@/lib/api/types'
import { collectionPath, collectionStatsPath, isRuleEmpty } from '@/lib/collections'
import { useDateFormat } from '@/lib/i18n/dateFormat'
import { cn } from '@/lib/utils'
import { CollectionDialog } from '@/routes/games/components/CollectionDialog'
import { formatCount, formatGameDate, formatPoints } from '@/routes/games/format'
import { Bar, ErrorBlock } from '@/routes/stats/kit/states'

import { setCollectionView, useCollectionView, type CollectionView } from './viewMode'

/** One column on a phone, as many 17rem columns as fit beyond it. */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3'

/** The table's box — the notes' list box, so the two screens' tables are one thing. */
const TABLE = 'flex flex-col rounded-lg border border-line bg-panel'

const VIEWS: readonly ViewOption<CollectionView>[] = [
  { id: 'grid', label: msg`Grid`, icon: LayoutGrid, hint: msg`A card per collection` },
  {
    id: 'table',
    label: msg`Table`,
    icon: Table2,
    hint: msg`A row per collection, to compare down a column`,
  },
]

export function CollectionsPage() {
  const { t } = useLingui()
  const overview = useCollectionOverview()
  const view = useCollectionView()
  const [creating, setCreating] = useState(false)
  /** The collection whose Edit is open. Deleting it from there leaves the reader here. */
  const [editing, setEditing] = useState<CollectionDetail | null>(null)
  const collections = overview.data?.collections ?? []
  const emptyShelf = overview.isSuccess && collections.length === 0

  return (
    <PageBody>
      <SetPageChrome
        breadcrumb={[{ label: t`Collections` }]}
        manual="guide/collections"
        actions={
          emptyShelf ? null : (
            <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              <Trans>New collection…</Trans>
            </Button>
          )
        }
      />

      {/* Over the list it switches, the way the notes' sits at the head of their filter row. */}
      {collections.length > 0 || overview.isPending ? (
        <div className="flex items-center">
          <ViewToggle
            views={VIEWS}
            value={view}
            onChange={setCollectionView}
            label={t`How to show the collections`}
          />
        </div>
      ) : null}

      {overview.isPending ? (
        view === 'table' ? (
          <div className={cn(TABLE, 'gap-2 p-3')} data-testid="loading">
            {[0, 1, 2].map((index) => (
              <Bar key={index} className="h-3 w-full" />
            ))}
          </div>
        ) : (
          <div className={GRID} data-testid="loading">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-3.5"
              >
                <Bar className="h-3 w-1/2" />
                <Bar className="h-2.5 w-4/5" />
                <Bar className="h-2.5 w-2/3" />
              </div>
            ))}
          </div>
        )
      ) : overview.isError ? (
        <ErrorBlock
          error={overview.error}
          onRetry={() => void overview.refetch()}
          className="flex-none"
        />
      ) : collections.length === 0 ? (
        <EmptyShelf onNew={() => setCreating(true)} />
      ) : view === 'table' ? (
        <div className={TABLE}>
          <TableHeader />
          <ul aria-label={t`Collections`}>
            {collections.map((collection) => (
              <CollectionRow
                key={collection.id}
                collection={collection}
                onEdit={() => setEditing(collection)}
              />
            ))}
          </ul>
        </div>
      ) : (
        <ul className={GRID} aria-label={t`Collections`}>
          {collections.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              onEdit={() => setEditing(collection)}
            />
          ))}
        </ul>
      )}

      {creating ? <CollectionDialog onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <CollectionDialog collection={editing} onClose={() => setEditing(null)} />
      ) : null}
    </PageBody>
  )
}

/**
 * Lifts a piece of a card or row over the name link's `::after`, so it gets its own
 * pointer: a button, or a figure whose `title` has to show on hover. Only those — the rest
 * is left under the link, which is what makes a click anywhere open the games.
 */
const ABOVE_THE_LINK = 'relative z-10'

/** The name link, stretched over the card or row it sits in. */
function NameLink({ collection, className }: { collection: CollectionDetail; className?: string }) {
  const { t } = useLingui()
  const collectionName = collection.name
  return (
    <Link
      to={collectionPath(collection.id)}
      title={t`Open the games in ${collectionName}`}
      className={cn(
        // The ring goes on the stretched `::after`, around the whole card or row it opens.
        'after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent-teal',
        className,
      )}
    >
      {collection.name}
    </Link>
  )
}

/**
 * The four figures both views draw, as text, with the dash where there is nothing yet. A
 * dash rather than leaving the figure out, because the figures are columns — in the table
 * literally, on the cards by position — and a missing one would shift the next into its
 * place.
 */
interface Figures {
  score: string
  /** On the score, when it counts fewer games than the collection holds, or none. */
  scoreNote?: string
  wins: string
  draws: string
  losses: string
  /** "4 won, 3 drawn, 1 lost", for the W-D-L's hover. */
  resultsNote?: string
  opponent: string
  blunders: string
  lastPlayed: string | null
}

const DASH = '—'

function useFigures(collection: CollectionDetail): Figures {
  const { t } = useLingui()
  const dateFormat = useDateFormat()
  const summary = collection.summary
  const last = summary.last_played_at ? formatGameDate(summary.last_played_at, dateFormat) : null
  if (summary.games === 0) {
    return {
      score: DASH,
      scoreNote:
        collection.game_count > 0
          ? t`No score: none of its games is one of yours with a known side.`
          : t`No games in it yet.`,
      wins: DASH,
      draws: DASH,
      losses: DASH,
      opponent: DASH,
      blunders: DASH,
      lastPlayed: last,
    }
  }
  const unscored = collection.game_count - summary.games
  const wins = formatCount(summary.wins)
  const draws = formatCount(summary.draws)
  const losses = formatCount(summary.losses)
  return {
    score: `${formatPoints(summary.points)} / ${formatCount(summary.games)}`,
    scoreNote:
      unscored > 0
        ? t`${plural(unscored, {
            one: '# game in it is not scored: a reference game, or one of yours whose side is not known yet',
            other: '# games in it are not scored: reference games, or yours whose side is not known yet',
          })}`
        : undefined,
    wins: `+${wins}`,
    draws: `=${draws}`,
    losses: `−${losses}`,
    resultsNote: t`${wins} won, ${draws} drawn, ${losses} lost`,
    opponent:
      summary.avg_opponent_rating === null || summary.avg_opponent_rating === undefined
        ? DASH
        : String(summary.avg_opponent_rating),
    blunders:
      summary.blunders_per_game === null || summary.blunders_per_game === undefined
        ? DASH
        : summary.blunders_per_game.toFixed(2),
    lastPlayed: last,
  }
}

/** The score, lifted over the link only when it has something to say on hover. */
function Score({ figures, className }: { figures: Figures; className?: string }) {
  return (
    <span
      title={figures.scoreNote}
      className={cn('font-mono tabular text-ink', figures.scoreNote && ABOVE_THE_LINK, className)}
    >
      {figures.score}
    </span>
  )
}

/** +W =D −L in the result colours, dashed through when nothing is scored. */
function Results({ figures }: { figures: Figures }) {
  return (
    <span
      title={figures.resultsNote}
      className={cn('font-mono tabular', figures.resultsNote && ABOVE_THE_LINK)}
    >
      <span className={figures.resultsNote ? 'text-good' : 'text-dim-2'}>{figures.wins}</span>{' '}
      <span className="text-dim">{figures.draws}</span>{' '}
      <span className={figures.resultsNote ? 'text-blunder' : 'text-dim-2'}>{figures.losses}</span>
    </span>
  )
}

/** The rule, or — its slot never empty — that the collection fills only by hand. */
function RuleLine({ collection }: { collection: CollectionDetail }) {
  const rule = collection.rule ?? null
  if (isRuleEmpty(rule)) {
    return (
      <span className="text-faint">
        <Trans>No rule · added by hand</Trans>
      </span>
    )
  }
  return (
    <>
      <RuleChips rule={rule} />
      <span className="text-faint">
        <Trans>· adds new imports</Trans>
      </span>
    </>
  )
}

/**
 * Edit and Stats. On a card they are the footer's tool buttons (`sm` `secondary`, the
 * control standard's footer button). In a table row they are `icon-xs` ghost squares: a
 * bordered button on every row of a list would be a column of boxes louder than the data,
 * and the words do not fit a fixed column in every language.
 */
function Actions({
  collection,
  onEdit,
  compact,
}: {
  collection: CollectionDetail
  onEdit: () => void
  compact?: boolean
}) {
  const { t } = useLingui()
  const collectionName = collection.name
  return (
    <>
      <Button
        type="button"
        size={compact ? 'icon-xs' : 'sm'}
        variant={compact ? 'ghost' : 'secondary'}
        onClick={onEdit}
        aria-label={t`Edit ${collectionName}`}
        title={compact ? t`Edit ${collectionName}` : undefined}
        className={ABOVE_THE_LINK}
      >
        {compact ? <Pencil aria-hidden /> : <Trans context="button">Edit</Trans>}
      </Button>
      <Button
        asChild
        size={compact ? 'icon-xs' : 'sm'}
        variant={compact ? 'ghost' : 'secondary'}
        className={ABOVE_THE_LINK}
      >
        <Link
          to={collectionStatsPath(collection.id)}
          aria-label={t`Stats for ${collectionName}`}
          title={t`Stats over this collection's games`}
        >
          {compact ? <BarChart3 aria-hidden /> : <Trans>Stats</Trans>}
        </Link>
      </Button>
    </>
  )
}

/** A figure on a card: its name over its value, in a fixed cell of a two-by-two grid. */
function Figure({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-meta tracking-[0.06em] text-dim-2 uppercase">{label}</dt>
      <dd className="text-data">{children}</dd>
    </div>
  )
}

/**
 * One collection as a card. Fixed slots top to bottom — name and count, one line of
 * description, the four figures, the rule line, the footer pinned to the bottom — so cards
 * side by side line up whatever each holds.
 */
function CollectionCard({
  collection,
  onEdit,
}: {
  collection: CollectionDetail
  onEdit: () => void
}) {
  const figures = useFigures(collection)
  const count = collection.game_count
  const lastPlayed = figures.lastPlayed
  return (
    <li className="relative flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-panel p-3.5 transition-colors hover:border-edge-hover">
      <div className="flex items-center gap-2">
        <CollectionSwatch color={collection.color} className="size-2.5" />
        <h2 className="min-w-0 flex-1 truncate text-heading font-semibold text-ink">
          <NameLink collection={collection} className="after:rounded-lg" />
        </h2>
        <span className="flex-none font-mono text-label tabular text-dim">
          <Plural value={count} one="# game" other="# games" />
        </span>
      </div>

      <p className="-mt-1 min-h-4 truncate text-data text-soft">{collection.description}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Figure label={<Trans>Your score</Trans>}>
          <Score figures={figures} />
        </Figure>
        <Figure label={<Trans>Results</Trans>}>
          <Results figures={figures} />
        </Figure>
        <Figure label={<Trans>Avg opponent</Trans>}>
          <span className="font-mono tabular text-body">{figures.opponent}</span>
        </Figure>
        <Figure label={<Trans>Blunders / game</Trans>}>
          <span className="font-mono tabular text-body">{figures.blunders}</span>
        </Figure>
      </dl>

      <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-1.5 text-label text-dim">
        <RuleLine collection={collection} />
      </div>

      <div className="mt-auto flex items-center gap-1.5 border-t border-hairline pt-2.5">
        <span className="min-w-0 truncate text-label text-dim-2">
          {lastPlayed ? (
            <Trans>Last played {lastPlayed}</Trans>
          ) : (
            <Trans>Nothing played yet</Trans>
          )}
        </span>
        <span className="flex-1" />
        <Actions collection={collection} onEdit={onEdit} />
      </div>
    </li>
  )
}

/**
 * Collection · games · score · results · last played · actions, then the average opponent,
 * blunders and the rule at `xl`, where there is room for them without squeezing the name.
 * One template for the header and every row, which is what keeps them aligned (the notes'
 * `LIST_COLUMNS` does the same). Below `md` there is no table to align: a row wraps into
 * the name and a line of what matters under it.
 */
const COLUMNS =
  'md:grid md:items-center md:gap-x-3 ' +
  'md:grid-cols-[minmax(0,1fr)_4rem_6rem_7.5rem_5rem_3.5rem] ' +
  'xl:grid-cols-[minmax(0,1fr)_4rem_6rem_7.5rem_5.5rem_5.5rem_minmax(0,12rem)_5rem_3.5rem]'

const HEAD = COLUMN_HEAD

/** The column names, once over the rows. Nothing to align below `md`, so nothing drawn. */
function TableHeader() {
  return (
    <div
      className={cn(COLUMNS, 'border-b border-line px-3 py-1.5 max-md:hidden')}
      aria-hidden
    >
      <span className={HEAD}>
        <Trans>Collection</Trans>
      </span>
      <span className={cn(HEAD, 'text-right')}>
        <Trans>Games</Trans>
      </span>
      <span className={HEAD}>
        <Trans>Your score</Trans>
      </span>
      <span className={HEAD}>
        <Trans>Results</Trans>
      </span>
      <span className={cn(HEAD, 'max-xl:hidden')}>
        <Trans>Avg opponent</Trans>
      </span>
      <span className={cn(HEAD, 'max-xl:hidden')}>
        <Trans>Blunders / game</Trans>
      </span>
      <span className={cn(HEAD, 'max-xl:hidden')}>
        <Trans>Rule</Trans>
      </span>
      <span className={HEAD}>
        <Trans>Last played</Trans>
      </span>
      <span />
    </div>
  )
}

/** One collection as a table row, the same figures as its card in the header's columns. */
function CollectionRow({
  collection,
  onEdit,
}: {
  collection: CollectionDetail
  onEdit: () => void
}) {
  const figures = useFigures(collection)
  return (
    <li className="border-b border-line last:border-b-0">
      <div
        className={cn(
          COLUMNS,
          'relative flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 text-data',
          ROW,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 max-md:basis-full">
          <CollectionSwatch color={collection.color} className="size-2 flex-none" />
          <NameLink collection={collection} className="flex-none font-medium text-ink" />
          {collection.description ? (
            <span className="min-w-0 truncate text-dim">{collection.description}</span>
          ) : null}
        </span>
        <span className="font-mono text-label tabular text-dim md:text-right">
          {formatCount(collection.game_count)}
        </span>
        <Score figures={figures} />
        <Results figures={figures} />
        <span className="font-mono tabular text-body max-xl:hidden">{figures.opponent}</span>
        <span className="font-mono tabular text-body max-xl:hidden">{figures.blunders}</span>
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-label text-dim max-xl:hidden">
          <RuleLine collection={collection} />
        </span>
        <span className="font-mono text-label tabular text-dim-2 max-md:ml-auto">
          {figures.lastPlayed ?? DASH}
        </span>
        <span className="flex items-center justify-end gap-0.5">
          <Actions collection={collection} onEdit={onEdit} compact />
        </span>
      </div>
    </li>
  )
}

/**
 * No collections yet: say what one is before offering to make one, and name the two other
 * doors — both in the games list, where the games to put in one already are.
 */
function EmptyShelf({ onNew }: { onNew: () => void }) {
  return (
    <div
      className="mx-auto flex max-w-[30rem] flex-col items-center gap-2.5 py-10 text-center max-md:py-6"
      data-testid="empty"
    >
      <span className="text-heading font-semibold text-ink">
        <Trans>No collections yet</Trans>
      </span>
      <p className="text-data leading-relaxed text-dim">
        <Trans>
          A collection is a named, coloured group of games — a league season, the club’s
          over-the-board games, the losses to go back to. A game can be in several, and every
          one stays in the library.
        </Trans>
      </p>
      <p className="text-data leading-relaxed text-dim">
        <Trans>
          Start one here, or from the games list: filter it to what the collection should hold
          and press Make a collection…, or tick games and use Add to under the table.
        </Trans>
      </p>
      <Button type="button" size="sm" onClick={onNew}>
        <Plus aria-hidden />
        <Trans>New collection…</Trans>
      </Button>
    </div>
  )
}
