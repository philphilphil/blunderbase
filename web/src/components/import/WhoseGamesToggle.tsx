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
 *
 * One value out of two, both on screen: the app's one `Segmented` (a raised thumb in a
 * sunken track), in sans like every label. It had been a mono pair with the blue fill,
 * which is what a pressed toolbar button and a narrowed filter look like.
 */
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'

import { Segmented } from '@/components/ui/segmented'

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
    <Segmented
      label={t`Whose games this PGN holds`}
      value={mine ? 'mine' : 'not-mine'}
      onChange={(value) => onChange(value === 'mine')}
      disabled={disabled}
      className={className}
      options={OPTIONS.map((option) => ({
        value: option.mine ? 'mine' : 'not-mine',
        label: i18n._(option.label),
        title: i18n._(option.title),
      }))}
    />
  )
}
