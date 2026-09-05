import type { I18n } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { Trans, useLingui } from '@lingui/react/macro'
import { ChevronRight } from 'lucide-react'

import { StatusDot } from '@/components/badges/StatusDot'
import type { EngineResponse } from '@/lib/api/types'
import type { EngineHost } from '@/lib/engines/hosts'
import { cn } from '@/lib/utils'

import { EngineDetail } from './EngineDetail'
import { KindBadge, RoleBadge } from './EngineBadges'
import { NO_ROLES, type EngineRoles } from './roles'

/**
 * The header and every row share one track list, so the columns can never be drawn two
 * widths. The five tracks are 25rem of fixed width before the name gets any, so below `md`
 * the two describing *policy and place* are dropped and the row keeps name, kind and state
 * — what it is scanned for. Neither dropped fact is only here: the assignment is the role
 * strip at the top of the same page, and the host is named again inside the detail the row
 * expands into.
 */
const COLUMNS =
  'grid-cols-[minmax(0,1fr)_5rem_7rem_8rem_5rem] max-md:grid-cols-[minmax(0,1fr)_5rem_4rem]'

/**
 * Every configured engine as one operational table, with its editor expanding directly
 * beneath the row. This is the winning prototype's central decision: kind, assignment,
 * location and state can be compared at a glance, while the large editor costs no space
 * until asked for and only one detail anywhere on the page can be open.
 *
 * "On" is deliberately narrower than "available". The roster knows the enabled flag and
 * runner connection, but a missing local binary is reported authoritatively by the role
 * strip when that engine is assigned. Calling every enabled row "Ready" would overclaim.
 */
export function EngineInventory({
  engines,
  hosts,
  roles,
  hostKnown,
  openDetail,
  onOpenDetail,
  localLabel,
}: {
  engines: EngineResponse[]
  hosts: Map<number, EngineHost>
  roles: Map<number, EngineRoles>
  hostKnown: boolean
  openDetail: string | null
  onOpenDetail: (detail: string | null) => void
  localLabel?: string
}) {
  const { t, i18n } = useLingui()
  // Resolved here rather than as a default parameter: a default is evaluated before the
  // component body runs, which is before `useLingui` has handed anything back.
  const local = localLabel ?? t`This server`
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel">
      <div
        className={cn(
          'grid gap-3 px-3 py-2 text-[0.625rem] tracking-[0.06em] text-faint uppercase',
          COLUMNS,
        )}
      >
        <span>
          <Trans context="inventory column">Engine</Trans>
        </span>
        <span>
          <Trans context="inventory column">Kind</Trans>
        </span>
        <span className="max-md:hidden">
          <Trans context="inventory column">Assignment</Trans>
        </span>
        <span className="max-md:hidden">
          <Trans context="inventory column">Where</Trans>
        </span>
        <span className="text-right">
          <Trans context="inventory column">State</Trans>
        </span>
      </div>
      {engines.map((engine) => {
        const host = hosts.get(engine.id)
        const expanded = openDetail === `engine:${engine.id}`
        const engineName = engine.name
        const state = engineState(engine, host, hostKnown, i18n)
        return (
          <div key={engine.id} className="border-t border-hairline">
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? t`Collapse ${engineName}` : t`Edit ${engineName}`}
              onClick={() => onOpenDetail(expanded ? null : `engine:${engine.id}`)}
              className={cn(
                'grid w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-raised',
                COLUMNS,
                expanded && 'bg-raised-2',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <ChevronRight
                  className={cn(
                    'size-3.5 flex-none text-faint transition-transform',
                    expanded && 'rotate-90',
                  )}
                  aria-hidden
                />
                <StatusDot
                  tone={state.tone === 'on' ? 'healthy' : state.tone === 'bad' ? 'degraded' : 'away'}
                />
                <span className="truncate text-[0.78125rem] font-medium text-ink">
                  {engine.name}
                </span>
                {engine.version ? (
                  <span className="truncate font-mono text-[0.625rem] text-faint">
                    {engine.version}
                  </span>
                ) : null}
              </span>
              <KindBadge kind={engine.kind} />
              <RoleBadge
                roles={roles.get(engine.id) ?? NO_ROLES}
                className="max-md:hidden"
              />
              <span className="truncate text-[0.6875rem] text-dim max-md:hidden">
                {hostLabel(host, hostKnown, local, i18n)}
              </span>
              <span
                className={cn(
                  'text-right text-[0.6875rem]',
                  state.tone === 'on'
                    ? 'text-good'
                    : state.tone === 'bad'
                      ? 'text-mistake'
                      : 'text-dim',
                )}
              >
                {state.label}
              </span>
            </button>
            {expanded ? (
              <EngineDetail
                engine={engine}
                host={host}
                hostKnown={hostKnown}
                roles={roles.get(engine.id)}
                embedded
                onDeleted={() => onOpenDetail(null)}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

type EngineTone = 'on' | 'off' | 'bad'

/**
 * The words these two say, as descriptors rather than strings.
 *
 * Neither function is a component, and the `t` macro only rewrites itself inside one — handed
 * `t` as an argument it stays a tagged template and the row renders blank. `msg` carries the
 * source text out to wherever the caller's `i18n` can resolve it, which is the render.
 */
const STATE = {
  checking: msg`Checking…`,
  off: msg({ message: 'Off', context: 'engine state' }),
  hostAway: msg`Host away`,
  queueOnly: msg`Queue only`,
  on: msg({ message: 'On', context: 'engine state' }),
}

const WHERE = {
  browser: msg`This browser`,
  remote: msg`Remote runner`,
}

function engineState(
  engine: EngineResponse,
  host: EngineHost | undefined,
  hostKnown: boolean,
  i18n: I18n,
): { label: string; tone: EngineTone } {
  if (!hostKnown) return { label: i18n._(STATE.checking), tone: 'off' }
  if (!engine.enabled) return { label: i18n._(STATE.off), tone: 'off' }
  if (host?.runnerId != null && !host.connected) {
    return { label: i18n._(STATE.hostAway), tone: 'bad' }
  }
  if (host?.transport === 'poll' && engine.kind === 'uci') {
    return { label: i18n._(STATE.queueOnly), tone: 'bad' }
  }
  return { label: i18n._(STATE.on), tone: 'on' }
}

function hostLabel(
  host: EngineHost | undefined,
  hostKnown: boolean,
  localLabel: string,
  i18n: I18n,
): string {
  if (!hostKnown) return i18n._(STATE.checking)
  if (!host || host.runnerId === null) return localLabel
  if (host.browser) return i18n._(WHERE.browser)
  return host.runnerName ?? i18n._(WHERE.remote)
}
