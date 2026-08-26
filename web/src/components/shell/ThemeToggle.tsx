import { Monitor, Moon, Sun } from 'lucide-react'

import { useTheme, THEME_PREFERENCES, type ThemePreference } from '@/lib/ui/theme'
import { cn } from '@/lib/utils'

const ICONS: Record<ThemePreference, typeof Moon> = {
  dark: Moon,
  light: Sun,
  system: Monitor,
}

const LABELS: Record<ThemePreference, string> = {
  dark: 'Dark',
  light: 'Light',
  system: 'Match the system',
}

/**
 * The titlebar's three-state theme control, built in the same segmented idiom as the
 * window/colour controls on Stats: a 1px `--bb-edge` group with the active cell filled
 * `--bb-selected`. Icon-only because it sits between two other titlebar widgets — the
 * accessible name and the tooltip carry the words.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, setPreference } = useTheme()

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn('flex overflow-hidden rounded-md border border-edge', className)}
    >
      {THEME_PREFERENCES.map((option, index) => {
        const Icon = ICONS[option]
        const active = option === preference
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            aria-label={LABELS[option]}
            title={
              option === 'system'
                ? `Match the system — currently ${resolved}`
                : `${LABELS[option]} theme`
            }
            onClick={() => setPreference(option)}
            className={cn(
              'flex items-center px-1.5 py-[0.3125rem] transition-colors',
              index > 0 && 'border-l border-edge',
              active ? 'bg-selected text-ink' : 'text-dim hover:text-ink',
            )}
          >
            <Icon className="size-3" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
