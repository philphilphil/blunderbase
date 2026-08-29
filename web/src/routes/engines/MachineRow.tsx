/**
 * The one row shape every machine in the table is drawn from — this server, this browser,
 * or a runner. Built once so the header and four different kinds of row can never draw the
 * same column two different widths.
 *
 * A row is a summary line (dot, name, a short status caption, what kind of machine it is,
 * its slots, its engine count) and, when expanded, a detail block underneath — the engines
 * it advertised, its connection, and its destructive actions. Only the caller knows what
 * that detail holds; this file only owns the shell and the columns lining up.
 *
 * The chevron leads the summary because it must advertise the disclosure before the owner
 * reads the row; it stays `aria-hidden` so the enclosing button remains the only control.
 */
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { StatusDot, type StatusDotTone } from '@/components/badges/StatusDot'
import { cn } from '@/lib/utils'

/** The three fixed-width columns after the name, shared by the header and every row. */
const MACHINE_COL = {
  type: 'w-[5.5rem] flex-none',
  slots: 'w-12 flex-none text-right',
  engines: 'w-10 flex-none text-right',
}

export type MachineTone = 'connected' | 'working' | 'degraded' | 'away' | 'bad'

/**
 * The facts and controls a machine contributes, independent of whether the page draws it
 * as an old table row or a compact capacity card. Keeping the behavior-owning browser and
 * runner components behind this seam lets the one-page layout change without duplicating
 * token, revoke or browser-worker logic.
 */
export interface MachinePresentation {
  tone: MachineTone
  name: string
  caption: string
  type: string
  slots: string
  engines: string
  actions?: ReactNode
  detail: ReactNode
}

const STATUS_TONE: Record<MachineTone, StatusDotTone> = {
  connected: 'healthy',
  working: 'working',
  degraded: 'degraded',
  away: 'away',
  bad: 'bad',
}

export function MachineDot({ tone }: { tone: MachineTone }) {
  return <StatusDot tone={STATUS_TONE[tone]} />
}

export function MachineHeaderRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-[0.625rem] tracking-[0.06em] text-faint uppercase">
      <span className="min-w-0 flex-1">Machine</span>
      <span className={MACHINE_COL.type}>Type</span>
      <span className={MACHINE_COL.slots}>Slots</span>
      <span className={MACHINE_COL.engines}>Engines</span>
    </div>
  )
}

export function MachineRow({
  tone,
  name,
  caption,
  type,
  slots,
  engines,
  expanded,
  onToggleExpand,
  actions,
  detail,
  ariaLabel,
  layout = 'row',
}: MachinePresentation & {
  expanded: boolean
  onToggleExpand: () => void
  ariaLabel: string
  /** Capacity cards are the one-page layout; rows remain for the old component during migration. */
  layout?: 'row' | 'card'
}) {
  if (layout === 'card') {
    return (
      <div className="contents">
        <div
          className={cn(
            'flex min-w-0 flex-col rounded-lg border bg-panel',
            expanded ? 'border-edge-strong bg-raised-2' : 'border-line',
          )}
        >
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={ariaLabel}
            className="flex min-w-0 items-center gap-2 px-3 py-2.5 text-left"
          >
            <ChevronRight
              className={cn(
                'size-3.5 flex-none text-faint transition-transform',
                expanded && 'rotate-90',
              )}
              aria-hidden
            />
            <MachineDot tone={tone} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-[0.8125rem] font-medium text-ink">{name}</span>
                <span className="truncate text-[0.6875rem] font-medium text-dim">{type}</span>
              </span>
              <span className="mt-0.5 block truncate text-[0.65625rem] text-dim">{caption}</span>
            </span>
            <span className="flex-none text-right">
              <span className="block font-mono text-[0.6875rem] text-soft">{slots}</span>
              <span className="block text-[0.59375rem] text-faint">
                {engines} engine{engines === '1' ? '' : 's'}
              </span>
            </span>
          </button>
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-hairline px-2.5 py-2">
              {actions}
            </div>
          ) : null}
        </div>
        {expanded ? (
          <div className="order-1 col-span-full rounded-lg border border-line bg-panel px-3 py-3">
            {detail}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-3">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={ariaLabel}
          className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
        >
          <ChevronRight
            className={cn('size-3.5 flex-none text-faint transition-transform', expanded && 'rotate-90')}
            aria-hidden
          />
          <MachineDot tone={tone} />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="flex-none truncate text-[0.78125rem] font-medium text-ink">
              {name}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-dim">{caption}</span>
          </span>
          <span className={cn(MACHINE_COL.type, 'truncate text-[0.71875rem] text-dim')}>
            {type}
          </span>
          <span className={cn(MACHINE_COL.slots, 'font-mono text-[0.71875rem] tabular text-dim')}>
            {slots}
          </span>
          <span className={cn(MACHINE_COL.engines, 'font-mono text-[0.71875rem] tabular text-dim')}>
            {engines}
          </span>
        </button>
        {actions ? <div className="flex flex-none items-center gap-1.5">{actions}</div> : null}
      </div>
      {expanded ? <div className="border-t border-hairline px-3 py-3">{detail}</div> : null}
    </div>
  )
}
