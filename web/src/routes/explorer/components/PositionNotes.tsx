/**
 * Design 2c's "Where this line goes wrong" card: what the coach wrote about *this*
 * position, styled as the note it is — an amber left edge and the `note via MCP` chip.
 *
 * Notes are never written here. They arrive over MCP (`write_note`) against a position and
 * come back from `GET /notes?fen=…`; the `note.created` / `note.updated` socket events
 * invalidate the `['notes']` prefix, so one appears in the open explorer without a reload.
 */
import { useNotes } from '@/lib/api/queries'
import { MCP_SERVER_NAME, relative } from '@/lib/mcp/status'

const LIMIT = 3

export function PositionNotes({ fen }: { fen: string }) {
  const notes = useNotes({ fen, limit: LIMIT })
  const found = notes.data ?? []
  if (found.length === 0) return null

  return (
    <div className="flex flex-none flex-col gap-[0.4375rem] rounded-[0.5625rem] border border-line border-l-2 border-l-mistake bg-panel p-[0.8125rem]">
      <div className="flex items-center gap-2">
        <span className="text-[0.75rem] font-semibold text-ink">Where this line goes wrong</span>
        <span
          className="inline-flex items-center gap-[0.3125rem] rounded-sm border border-edge px-1.5 py-px text-[0.625rem] text-soft"
          title={`written over MCP by ${MCP_SERVER_NAME}`}
        >
          <span className="size-[0.3125rem] rounded-full bg-good" />
          note via MCP
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-faint">{relative(found[0].created_at)}</span>
      </div>

      {found.map((note) => (
        <p
          key={note.id}
          className="whitespace-pre-wrap text-[0.78125rem] leading-[1.55] text-body-2"
        >
          {note.text}
        </p>
      ))}
    </div>
  )
}
