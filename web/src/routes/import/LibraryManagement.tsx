import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useGames } from '@/lib/api/queries'
import type { GamesDeleted } from '@/lib/api/types'

import { DeleteAllGamesDialog } from './DeleteAllGamesDialog'

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/**
 * Emptying the library, at the bottom of the page that fills it.
 *
 * It was a danger zone on the Settings page, which is where a destructive button is
 * hardest to reason about: nothing else on that screen touched a game. Here it reads as
 * the other end of the same sentence as Connect an account and Upload a PGN.
 *
 * One line, like the rating beside it: what the button does belongs in the dialog that
 * asks for the password (`DeleteAllGamesDialog`), which is where a person is actually
 * deciding — a paragraph spelling out the consequences above an unpressed button is read
 * by nobody and makes the row twice as tall as it earns.
 */
export function LibraryManagement() {
  const games = useGames({ limit: 1 })
  const [asking, setAsking] = useState(false)
  const [deleted, setDeleted] = useState<GamesDeleted | null>(null)
  const total = games.data?.total

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-blunder/28 bg-panel px-3.5 py-3">
      <span className="text-xs font-semibold text-ink">Library</span>
      {deleted ? (
        <p role="status" className="text-[0.6875rem] text-dim">
          {`Deleted ${plural(deleted.games, 'game')}, ${plural(deleted.runs, 'analysis run')} and ${plural(deleted.notes, 'note')}.`}
        </p>
      ) : (
        <span className="text-[0.6875rem] text-dim">
          {total === undefined ? 'in this database' : `${plural(total, 'game')} in this database`}
        </span>
      )}
      <div className="flex-1" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-blunder/40 text-blunder hover:border-blunder hover:text-blunder"
        onClick={() => {
          setDeleted(null)
          setAsking(true)
        }}
      >
        <Trash2 aria-hidden />
        Reset imported library…
      </Button>
      {asking ? (
        <DeleteAllGamesDialog
          games={total}
          onClose={() => setAsking(false)}
          onDone={(result) => {
            setDeleted(result)
            setAsking(false)
          }}
        />
      ) : null}
    </div>
  )
}
