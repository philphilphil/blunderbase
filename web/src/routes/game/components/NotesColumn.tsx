import type { ReactNode } from 'react'

import { McpPanel } from '@/components/shell/McpStatus'
import { Skeleton } from '@/components/ui/skeleton'
import type { MoveRow } from '@/lib/api/types'
import { GLYPHS, glyphFor } from '@/lib/chess/classification'
import { MCP_SERVER_NAME, relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

import { noteAccent, plyLabel, type GameNote, type RecurringMistake } from '../gameModel'

const PATTERN_COLOR = 'var(--bb-accent)'

/**
 * The right-hand column from design 1a: what the coach wrote, attributed to the MCP server
 * that carried it, plus the recurring-mistake card and the deep-analysis trigger.
 *
 * Notes are never written here — they arrive from the coach over MCP and land in the open
 * page through the `note.created` / `note.updated` socket events.
 */
export function NotesColumn({
  notes,
  moves,
  recurring,
  recurringPending,
  onSelectPly,
  footer,
  className,
}: {
  notes: GameNote[]
  moves: MoveRow[]
  recurring: RecurringMistake | null
  /** `/stats/worst-moments` is a second request, so the pattern card arrives later. */
  recurringPending: boolean
  onSelectPly: (ply: number) => void
  /** The deep-analysis card and the MCP panel, pinned to the bottom. */
  footer: ReactNode
  className?: string
}) {
  const newest = notes[0]

  return (
    <div className={cn('flex min-h-0 flex-col bg-panel', className)}>
      <div className="flex h-[2.375rem] flex-none items-center gap-2 border-b border-hairline px-3.5">
        <span className="text-xs font-semibold text-ink">Notes</span>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-edge px-1.5 py-px text-[0.625rem] text-soft">
          <span className="size-[0.3125rem] rounded-full bg-good" />
          via MCP
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] tabular text-dim">{notes.length}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3 py-2.5">
        <div className="flex items-center gap-[0.4375rem] px-0.5 font-mono text-[0.625rem] text-dim">
          <span className="text-soft">your assistant</span>
          <span className="text-faint-2">→</span>
          <span>{MCP_SERVER_NAME}</span>
          <div className="flex-1" />
          <span>{newest ? relative(newest.created_at) : '—'}</span>
        </div>

        {notes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-edge-strong bg-elevated-2/50 p-3.5 text-[0.71875rem] leading-[1.55] text-dim">
            No notes on this game yet. Ask your assistant to look at it — anything it writes
            with <span className="font-mono text-soft">write_note</span> appears here without a
            reload.
          </div>
        ) : null}

        {notes.map((note) => (
          <NoteCard key={note.id} note={note} moves={moves} onSelectPly={onSelectPly} />
        ))}

        {recurring ? <RecurringCard recurring={recurring} /> : null}
        {!recurring && recurringPending ? <Skeleton className="h-16 rounded-lg" /> : null}
      </div>

      <div className="flex flex-none flex-col gap-2.5 border-t border-hairline p-3">
        {footer}
        <McpPanel />
      </div>
    </div>
  )
}

function NoteCard({
  note,
  moves,
  onSelectPly,
}: {
  note: GameNote
  moves: MoveRow[]
  onSelectPly: (ply: number) => void
}) {
  const accent = noteAccent(note, moves)
  const glyph = accent && accent !== 'pattern' ? glyphFor(accent) : null
  const color = accent === 'pattern' ? PATTERN_COLOR : glyph ? GLYPHS[glyph].color : 'var(--bb-edge)'

  const move = note.ply === null || note.ply === undefined
    ? undefined
    : moves.find((row) => row.ply === note.ply)
  const label = move?.san ? `${plyLabel(move.ply)}${move.san}` : 'note'
  const kicker =
    accent === 'pattern'
      ? 'pattern'
      : glyph
        ? `${GLYPHS[glyph].label} · the moment`
        : note.scope === 'game'
          ? 'on the game'
          : 'on a position'

  const Wrapper = move ? 'button' : 'div'
  return (
    <Wrapper
      {...(move
        ? {
            type: 'button' as const,
            // `note.ply` is the position the note is about, and `moves[ply]` is the move
            // played *from* it (`GamePosition.ply` and `MoveEval.ply` are the same index).
            // The cursor is the ply last played, so landing on `ply - 1` puts the board in
            // the noted position — the same "one ply short" the J/j shortcuts use, and what
            // makes the engine lines and Maia's card describe the move the note is about.
            onClick: () => onSelectPly(move.ply - 1),
          }
        : {})}
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border border-line bg-elevated-2 px-3 py-[0.6875rem] text-left',
        move && 'hover:border-edge',
      )}
      style={{ borderLeft: `0.125rem solid ${color}` }}
    >
      <div className="flex items-center gap-[0.4375rem]">
        <span className="font-mono text-[0.625rem]" style={{ color }}>
          {label}
        </span>
        <span className="text-[0.625rem] text-faint">{kicker}</span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-faint">{relative(note.created_at)}</span>
      </div>
      <p className="whitespace-pre-wrap text-[0.78125rem] leading-[1.55] text-body-2">{note.text}</p>
      {note.tags && note.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-sm border border-chip-info-edge px-1 py-px font-mono text-[0.59375rem] text-info"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </Wrapper>
  )
}

/**
 * Derived, not written: the worst blunder of this game against every blunder of the last
 * 30 days that shares its piece and phase (`/stats/worst-moments`).
 */
function RecurringCard({ recurring }: { recurring: RecurringMistake }) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-line bg-elevated-2 px-3 py-[0.6875rem]"
      style={{ borderLeft: `0.125rem solid ${PATTERN_COLOR}` }}
      data-testid="recurring-card"
    >
      <div className="flex items-center gap-[0.4375rem]">
        <span className="font-mono text-[0.625rem] text-accent-teal">pattern</span>
        <span className="text-[0.625rem] text-faint">
          {recurring.ordinal} time in {recurring.days} days
        </span>
      </div>
      <p className="text-[0.78125rem] leading-[1.55] text-body-2">
        {recurring.count} of your recent blunders were {recurring.piece} moves in the{' '}
        {recurring.phase}. This game contributed one of them.
      </p>
    </div>
  )
}
