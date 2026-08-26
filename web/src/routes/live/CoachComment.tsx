import { relative } from '@/lib/mcp/status'
import { cn } from '@/lib/utils'

/**
 * The sentence or two the coach put under the board.
 *
 * `annotate(text=…)` replaces it and `annotate(text="")` clears it, so this card is
 * either the current comment or an explicit note that there is none — never a stale one.
 */
export function CoachComment({
  text,
  updatedAt,
  className,
}: {
  text: string | null | undefined
  updatedAt: string | null | undefined
  className?: string
}) {
  return (
    <section className={cn('flex flex-col rounded-xl border border-line bg-panel', className)}>
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <span className="text-xs font-semibold text-ink">Coach</span>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-edge px-1.5 py-px text-[0.625rem] text-soft">
          <span className="size-[0.3125rem] rounded-full bg-good" />
          via MCP
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-dim">{relative(updatedAt)}</span>
      </div>

      <div className="px-3.5 py-3">
        {text ? (
          <p className="border-l-2 border-accent-teal/60 pl-2.5 text-[0.78125rem] leading-[1.55] text-body-2">
            {text}
          </p>
        ) : (
          <p className="text-[0.71875rem] leading-[1.5] text-dim">
            Nothing said yet. Whatever your assistant writes with{' '}
            <span className="font-mono text-soft-2">annotate</span> appears here as it types
            it.
          </p>
        )}
      </div>
    </section>
  )
}
