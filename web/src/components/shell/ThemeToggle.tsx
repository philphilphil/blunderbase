import { type MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { Monitor, Moon, Sun } from 'lucide-react'

import {
  useTheme,
  THEME_PREFERENCES,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/ui/theme'
import { cn } from '@/lib/utils'

const ICONS: Record<ThemePreference, typeof Moon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
}

const LABELS = {
  dark: msg`Dark`,
  light: msg`Light`,
  system: msg`Match the system`,
} satisfies Record<ThemePreference, MessageDescriptor>

const RESOLVED = {
  dark: msg`dark`,
  light: msg`light`,
} satisfies Record<ResolvedTheme, MessageDescriptor>

/**
 * The three-state theme control, built in the same segmented idiom as the window/colour
 * controls on Stats: a 1px `--bb-edge` group over the toolbar's own control fill, with the
 * active cell filled `--bb-selected`. Icon-only because it sits between two other titlebar
 * widgets — the accessible name and the tooltip carry the words.
 *
 * It renders twice in the shell and is visible once: the titlebar's copy at `md` and up
 * (`TopBar`), the rail footer's below it (`SideNav`), which is what the phone's drawer
 * carries. Preference, resolution and storage are the provider's, so the two are the same
 * control wherever it is drawn.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme()
  const { t, i18n } = useLingui()

  return (
    <div
      role="group"
      aria-label={t`Theme`}
      className={cn(
        'flex flex-none overflow-hidden rounded-md border border-edge bg-elevated',
        className,
      )}
    >
      {THEME_PREFERENCES.map((option, index) => {
        const Icon = ICONS[option]
        const active = option === preference
        const label = i18n._(LABELS[option])
        const current = i18n._(RESOLVED[resolved])
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            aria-label={label}
            title={
              option === 'system' ? t`Match the system — currently ${current}` : t`${label} theme`
            }
            onClick={() => setPreference(option)}
            className={cn(
              'flex items-center px-[0.4375rem] py-[0.3125rem] transition-colors',
              index > 0 && 'border-l border-edge',
              active ? 'bg-selected text-ink' : 'text-dim hover:bg-raised hover:text-ink',
            )}
          >
            <Icon className="size-3" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
