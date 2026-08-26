import type { ReactNode } from 'react'

import { ThemeToggle } from '@/components/shell/ThemeToggle'
import { cn } from '@/lib/utils'

/**
 * The frame both doors share: the brand mark over one `bb-card` on the app's own ground,
 * centred and no wider than a password field needs to be. The theme control is here too —
 * a fresh deployment is set up on this screen, and the owner may want it in the theme they
 * are going to live in.
 */
export function AuthScreen({
  title,
  description,
  children,
}: {
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-void px-6 py-10">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="flex w-full max-w-[22rem] flex-col gap-4">
        <div className="flex items-center justify-center gap-2">
          {/* Drawn for a light ground, so the dark theme inverts it — as in the titlebar. */}
          <img
            src="/logo.png"
            alt=""
            className="size-[1.375rem] dark:[filter:invert(1)_hue-rotate(180deg)]"
          />
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink">Blunderbase</span>
        </div>

        <div className="bb-card flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[0.875rem] font-semibold text-ink">{title}</h1>
            <p className="text-[0.75rem] leading-[1.65] text-dim">{description}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

/** One field, labelled, in the stack spacing the rest of the app's forms use. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus,
  invalid,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  autoFocus?: boolean
  invalid?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.6875rem] font-medium text-soft">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="password"
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-8 w-full min-w-0 rounded-md border border-input bg-elevated px-2.5 text-xs text-ink outline-none transition-colors',
          'placeholder:text-faint focus-visible:border-accent-teal/50',
          'aria-invalid:border-blunder',
        )}
      />
    </div>
  )
}

/** Whatever went wrong, in the one place a form says so. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[0.6875rem] leading-[1.55] text-blunder">
      {children}
    </p>
  )
}
