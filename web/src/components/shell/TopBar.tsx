import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import { useEvents } from '@/lib/events/EventsProvider'
import { cn } from '@/lib/utils'

import { AccountMenu } from './AccountMenu'
import { McpIndicator } from './McpStatus'
import { ThemeToggle } from './ThemeToggle'
import { QueueIndicator } from './QueueIndicator'
import { usePageChrome } from './PageChrome'

function ConnectionDot() {
  const { status, reconnects } = useEvents()
  const label =
    status === 'open'
      ? `live${reconnects > 0 ? ` · reconnected ${reconnects}×` : ''}`
      : status === 'connecting'
        ? 'connecting to /events'
        : 'offline — retrying'
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'size-[0.375rem] rounded-full',
        status === 'open'
          ? 'bg-accent-teal'
          : status === 'connecting'
            ? 'bg-mistake'
            : 'bg-blunder',
      )}
    />
  )
}

/** The 46px titlebar: brand, breadcrumb, then queue / MCP / shortcut / avatar. */
export function TopBar() {
  const { breadcrumb, actions } = usePageChrome()

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
      <ConnectionDot />
      <ThemeToggle />
      <QueueIndicator />
      <McpIndicator />
      <div className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-[0.3125rem] font-mono text-[0.6875rem] text-dim">
        ⌘K
      </div>
      <AccountMenu />
    </header>
  )
}
