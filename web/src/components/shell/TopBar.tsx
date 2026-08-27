import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

import { AccountMenu } from './AccountMenu'
import { useCommandPalette } from './CommandPalette'
import { QueueIndicator } from './QueueIndicator'
import { usePageChrome } from './PageChrome'

/** The 46px titlebar: brand, breadcrumb, then page actions / queue / shortcut / account. */
export function TopBar() {
  const { breadcrumb, actions } = usePageChrome()
  const palette = useCommandPalette()

  return (
    <header className="flex h-[2.875rem] flex-none items-center gap-3.5 border-b border-hairline bg-panel px-4">
      <Link to="/" className="flex items-center gap-2">
        {/*
          The brand mark is drawn for a light ground (a near-black pawn with a teal band),
          so the light theme takes it as-is; inverting it and putting the hue back is what
          makes it legible on the dark `--bb-panel` without shipping a second asset.
        */}
        <img
          src="/logo.png"
          alt=""
          className="size-[1.1875rem] dark:[filter:invert(1)_hue-rotate(180deg)]"
        />
        <span className="text-[0.8125rem] font-semibold tracking-[-0.01em] text-ink">Blunderbase</span>
      </Link>
      <div className="h-[1.125rem] w-px bg-line" />

      {breadcrumb.length > 0 ? (
        <div className="flex min-w-0 items-center gap-[0.4375rem] text-xs text-dim">
          {breadcrumb.map((crumb, index) => (
            <Fragment key={index}>
              {index > 0 ? <span className="text-faint-2">/</span> : null}
              {crumb.to ? (
                <Link
                  to={crumb.to}
                  className={cn('truncate text-dim hover:text-ink', crumb.mono && 'font-mono')}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    'truncate',
                    crumb.mono && 'font-mono',
                    index === breadcrumb.length - 1 && 'text-body-3',
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </Fragment>
          ))}
        </div>
      ) : null}

      <div className="flex-1" />

      {actions}
      <QueueIndicator />
      {/* The chip was always a label for the shortcut; now it is also the way to press it. */}
      <button
        type="button"
        onClick={palette.open}
        aria-label="Search everything"
        title="Search everything (⌘K)"
        className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-[0.3125rem] font-mono text-[0.6875rem] text-dim transition-colors hover:border-edge-hover hover:text-ink"
      >
        ⌘K
      </button>
      <AccountMenu />
    </header>
  )
}
