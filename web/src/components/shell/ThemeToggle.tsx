import { type MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { Monitor, Moon, Sun } from 'lucide-react'

import { Segmented } from '@/components/ui/segmented'
import {
  useTheme,
  THEME_PREFERENCES,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/ui/theme'

const ICONS: Record<ThemePreference, typeof Moon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
}

const LABELS = {
  dark: msg`Dark`,
  light: msg`Light`,
  system: msg`System`,
} satisfies Record<ThemePreference, MessageDescriptor>

const RESOLVED = {
  dark: msg`dark`,
  light: msg`light`,
} satisfies Record<ResolvedTheme, MessageDescriptor>

/**
 * The three-state theme choice, as the account menu's Appearance row draws it: the app's
 * one `Segmented` (a radio group, the chosen option a raised neutral thumb), each option an
 * icon and its word.
 *
 * It used to be three icon cells in the titlebar and again in the phone drawer's foot. A
 * theme is set once and left, like the language, so it moved to the account menu beside
 * the language (the clarity pass), where it is drawn once and reached the same way at every
 * width; with words now, because the menu has the room and "Monitor" never said "follow
 * the system". Preference, resolution, storage and the pre-paint script are the theme
 * provider's, unchanged: only where the control lives moved.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme()
  const { t, i18n } = useLingui()
  const current = i18n._(RESOLVED[resolved])

  return (
    <Segmented
      label={t`Appearance`}
      size="xs"
      value={preference}
      onChange={setPreference}
      className={className}
      options={THEME_PREFERENCES.map((option) => ({
        value: option,
        label: i18n._(LABELS[option]),
        icon: ICONS[option],
        title: option === 'system' ? t`Match the system — currently ${current}` : undefined,
      }))}
    />
  )
}
