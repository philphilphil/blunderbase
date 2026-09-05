/**
 * Whose games a PGN holds — the one question a PGN upload cannot answer for itself.
 *
 * A sync knows: the games under an account's name are that account's. A file does not. It
 * is as likely to be a master collection, an opening survey or a friend's export as it is
 * to be one's own archive, and storing somebody else's games as the owner's puts moves
 * they never played into every statistic. So the upload asks, in the same words the games
 * list filters by (`Mine` / `Others`), and the answer rides along as `mine`.
 *
 * The default is Mine because the common PGN really is one's own export — this is a
 * question put where it can be seen and changed, not a modal in the way of the usual case.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'

import { cn } from '@/lib/utils'

const OPTIONS: { label: MessageDescriptor; mine: boolean; title: MessageDescriptor }[] = [
  {
    label: msg`Mine`,
    mine: true,
    title: msg`Games you played. They count in every statistic, and the sides are attributed to your accounts.`,
  },
  {
    label: msg`Not mine`,
    mine: false,
    title: msg`Somebody else's games — a master collection, a friend's export. Analysed and annotated like any other game, and counted in no statistic.`,
  },
]

export function WhoseGamesToggle({
  mine,
  onChange,
  disabled,
  className,
}: {
  mine: boolean
  onChange: (mine: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const { t, i18n } = useLingui()
  return (
    <div
      role="group"
      aria-label={t`Whose games this PGN holds`}
      className={cn(
        'flex overflow-hidden rounded-md border border-edge bg-elevated font-mono text-[0.65625rem]',
        disabled && 'opacity-50',
        className,
      )}
    >
      {OPTIONS.map((option, index) => (
        <button
          key={option.mine ? 'mine' : 'not-mine'}
          type="button"
          disabled={disabled}
          aria-pressed={mine === option.mine}
          title={i18n._(option.title)}
          onClick={() => onChange(option.mine)}
          className={cn(
            'px-2 py-[0.1875rem] transition-colors',
            index > 0 && 'border-l border-edge',
            mine === option.mine ? 'bg-selected text-ink' : 'text-dim hover:text-ink',
          )}
        >
          {i18n._(option.label)}
        </button>
      ))}
    </div>
  )
}
