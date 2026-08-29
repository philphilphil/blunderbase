import { Menu, Search } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'

import { AccountMenu } from './AccountMenu'
import { useCommandPalette } from './CommandPalette'
import { QueueIndicator } from './QueueIndicator'
import { usePageChrome } from './PageChrome'

/**
 * The 46px titlebar: brand, breadcrumb, then page actions / queue / shortcut / account.
 *
 * On a phone the row has about 375px to spend and four things that must stay reachable —
 * the way back to the rail, the queue, search and the account — so the two that repeat
 * something already on screen give up their space first: the wordmark (the mark itself is
 * still the link home) and the breadcrumb (the page prints its own title under the bar).
 * The ⌘K chip keeps its button and drops the glyph for a magnifier, since a phone has no
 * ⌘ to press but still wants the search.
 *
 * The horizontal padding is `max(1rem, …)` of the safe-area inset rather than `px-4`, so a
 * landscape iPhone's notch does not sit on the hamburger; away from a notch every one of
 * those insets is 0 and the bar is the 46px × 16px it always was. The `env()` fallbacks are
 * written `0rem` rather than the usual `0px` because `lib/ui/scale.test.ts` bans a px
 * length from a Tailwind arbitrary value — at zero the two are the same length anyway.
 */
export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { breadcrumb, actions } = usePageChrome()
  const palette = useCommandPalette()

  return (
    <header className="flex h-[calc(2.875rem+env(safe-area-inset-top,0rem))] flex-none items-center gap-3.5 border-b border-hairline bg-panel pt-[env(safe-area-inset-top,0rem)] pr-[max(1rem,env(safe-area-inset-right,0rem))] pl-[max(1rem,env(safe-area-inset-left,0rem))] max-md:gap-2.5">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open the navigation"
        className="-ml-1 rounded-md p-1 text-dim transition-colors hover:bg-raised hover:text-ink md:hidden"
      >
        <Menu className="size-4" />
      </button>
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
        <span className="text-[0.8125rem] font-semibold tracking-[-0.01em] text-ink max-md:hidden">
          Blunderbase
        </span>
      </Link>
      <div className="h-[1.125rem] w-px bg-line max-md:hidden" />

      {breadcrumb.length > 0 ? (
        <div className="flex min-w-0 items-center gap-[0.4375rem] text-xs text-dim max-md:hidden">
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
        className="flex flex-none items-center gap-1.5 rounded-md border border-edge px-2.5 py-[0.3125rem] font-mono text-[0.6875rem] text-dim transition-colors hover:border-edge-hover hover:text-ink max-md:px-2"
      >
        <Search className="size-3.5 md:hidden" aria-hidden />
        <span className="max-md:hidden">⌘K</span>
      </button>
      <AccountMenu />
    </header>
  )
}
