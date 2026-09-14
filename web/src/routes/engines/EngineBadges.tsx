/**
 * The chips the Engines page uses for itself, and nothing outside it does.
 *
 * Deliberately not `RunBadge`. On a game row that badge says what ran — "d24 · 2 lines", a
 * fact about work that happened. The old tier badge was once reused here to mean "this
 * engine is the one assigned to deep runs" — a role. Same pixels, unrelated claims, and the
 * owner reading "Deep" beside an engine name had no way to tell which one was meant. Keeping
 * the two vocabularies in two components is what keeps a run chip unambiguous everywhere
 * else.
 *
 * These are quieter than a run badge on purpose: on this page the name is the headline and
 * the chips are the annotation, where on a game row what ran *is* the headline.
 */
import { useLingui } from '@lingui/react/macro'

import type { EngineKind } from '@/lib/api/types'
import { cn } from '@/lib/utils'

import { NO_ROLE_LABEL, roleLabel, type EngineRoles } from './roles'

/**
 * What kind of engine this is. Every row gets one, including a human-move model — which
 * previously carried no chip at all, so the one fact that matters about it (it predicts
 * human moves rather than searching) appeared nowhere.
 *
 * `UCI` and `Maia` were the words the backend uses for these, said at the owner. UCI is a
 * protocol they never chose and Maia is a model family they may not have heard of; the
 * distinction they actually make is between a normal engine and one that plays like a
 * person. `AddEngineForm` offers the same two words in the same order.
 */
export function KindBadge({ kind, className }: { kind: EngineKind; className?: string }) {
  const { t } = useLingui()
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center rounded-sm border px-1.5 py-px text-[0.59375rem]',
        kind === 'maia'
          ? 'border-deep/28 bg-deep/10 text-deep'
          : 'border-edge bg-elevated text-soft',
        className,
      )}
    >
      {kind === 'maia' ? t`Human` : t`Engine`}
    </span>
  )
}

/**
 * What this engine is assigned to — `Analysis`, `Human moves`, or an em dash.
 *
 * The em dash is unbordered: an engine that serves nothing should read as a quiet fact
 * about the roster, not as a chip claiming something.
 */
export function RoleBadge({ roles, className }: { roles: EngineRoles; className?: string }) {
  const { t } = useLingui()
  const label = roleLabel(roles)
  const idle = label === NO_ROLE_LABEL
  return (
    <span
      title={idle ? t`Assigned to nothing right now` : undefined}
      className={cn(
        'inline-flex flex-none items-center rounded-sm border px-1.5 py-px text-[0.59375rem]',
        idle ? 'border-transparent text-faint' : 'border-edge-strong bg-raised text-soft',
        className,
      )}
    >
      {label}
    </span>
  )
}
