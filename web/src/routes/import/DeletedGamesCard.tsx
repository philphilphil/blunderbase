/**
 * The deletion record: the games an import will not store again, and the way to take that
 * back.
 *
 * Deleting a game deletes the only record of it, and the importer deduplicates by looking
 * in the games table — so without these rows the next sync of a source would bring the game
 * back as something new (chess.com re-reads the month still being played on every sync, so
 * that is the ordinary case). Which makes this screen the other half of the delete: without
 * somewhere to see and undo it, "deleted" would be a decision nobody could revisit.
 *
 * Forgetting a row brings no game back. It gives the next import permission to store it
 * again, without the analysis and the notes that went with the original — which is why the
 * button says Forget rather than Restore.
 *
 * Collapsed by default and absent entirely on a library that has deleted nothing: this is a
 * record to consult, not a thing to read every time the page opens.
 */
import { ChevronDown, ChevronRight, Loader2, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { SourceBadge } from '@/components/badges/SourceBadge'
import { Button } from '@/components/ui/button'
import { useDeletedGames, useForgetDeletions } from '@/lib/api/queries'
import type { DeletedGame } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { stamp } from './format'

/** How many rows the card lists before it defers to "and N more". */
const SHOWN = 25

export function DeletedGamesCard() {
  const [open, setOpen] = useState(false)
  const deleted = useDeletedGames({ limit: SHOWN })
  const forget = useForgetDeletions()
  const total = deleted.data?.total ?? 0
  const rows = deleted.data?.games ?? []
  const pending = forget.isPending ? forget.variables : undefined

  // Nothing deleted, nothing to explain. The card appears with the first deletion.
  if (total === 0) return null

  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
        <Undo2 className="size-4 text-faint" aria-hidden />
        <div className="min-w-56 flex-1">
          <h2 className="text-xs font-semibold text-ink">Deleted games</h2>
          <p className="mt-1 text-[0.6875rem] leading-[1.5] text-dim">
            {total === 1 ? 'One game is' : `${total.toLocaleString('en-US')} games are`} on
            record as deleted, so importing {total === 1 ? 'it' : 'them'} again is refused —
            otherwise the next sync would put {total === 1 ? 'it' : 'them'} straight back.
            Forgetting a row lets the next import store that game again, with no analysis and
            no notes.
          </p>
          {forget.isError ? (
            <p role="alert" className="mt-1 text-[0.6875rem] text-blunder">
              {forget.error.message}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          {open ? 'Hide' : 'Show'} list
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={forget.isPending}
          onClick={() => forget.mutate(undefined)}
        >
          {forget.isPending && pending === undefined ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : null}
          Forget all
        </Button>
      </div>

      {open ? (
        <ul className="flex flex-col border-t border-hairline">
          {deleted.isPending ? (
            <li className="px-4 py-3 text-[0.6875rem] text-dim">Reading the record…</li>
          ) : null}
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              busy={forget.isPending && pending?.includes(row.id) === true}
              onForget={() => forget.mutate([row.id])}
            />
          ))}
          {total > rows.length ? (
            <li className="px-4 py-2 text-[0.6875rem] text-dim">
              and {(total - rows.length).toLocaleString('en-US')} more — “Forget all” covers
              every one of them.
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  )
}

/**
 * One record. The source and its ID are what an import is matched on, so they are what the
 * row leads with; the players and the date are how a person recognises which game it was —
 * a game with no source ID (a PGN, an OTB game) has nothing else to go by.
 */
function Row({
  row,
  busy,
  onForget,
}: {
  row: DeletedGame
  busy: boolean
  onForget: () => void
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-4 py-2 last:border-b-0">
      <SourceBadge source={row.source} size="sm" />
      <span
        className={cn(
          'w-40 flex-none truncate font-mono text-[0.6875rem]',
          row.source_id ? 'text-soft' : 'text-faint',
        )}
        title={row.source_id ?? row.dedup_hash}
      >
        {row.source_id ?? `${row.dedup_hash.slice(0, 12)}…`}
      </span>
      <span className="min-w-40 flex-1 truncate text-[0.71875rem] text-body">
        {row.white_name} vs {row.black_name}
      </span>
      <span className="font-mono text-[0.6875rem] text-dim tabular">
        {row.played_at ? stamp(row.played_at) : '—'}
      </span>
      <span className="font-mono text-[0.65625rem] text-faint tabular">
        deleted {stamp(row.deleted_at)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={onForget}
        aria-label={`Forget the deletion of ${row.white_name} vs ${row.black_name}`}
      >
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Forget
      </Button>
    </li>
  )
}
