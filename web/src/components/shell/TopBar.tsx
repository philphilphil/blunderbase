import { useLingui } from '@lingui/react/macro'
import { ChevronLeft, ChevronRight, Menu, Search } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/lib/ui/media'
import { cn } from '@/lib/utils'

import { useCommandPalette } from './CommandPalette'
import { EngineToggle } from './EngineToggle'
import { usePageChrome, type Crumb, type PageBack } from './PageChrome'
import { QueueIndicator } from './QueueIndicator'

/**
 * The page's name as the bar prints it: the way there, then the title.
 *
 * The title is the last crumb in `text-heading`, a step up from the old `text-data` crumb
 * and the one heading the page has (pages print no in-page title; a crumb over an `h1` over
 * the same word was one name said three times). Every crumb before it is a place, so it is
 * a link that says so on hover (ink and an underline), with a `›` between: the old `/`
 * separators and grey non-link crumbs made the trail read as a path you could not walk.
 * Only the title stays on a phone, since nothing else there says where you are.
 */
function Trail({ crumbs }: { crumbs: Crumb[] }) {
  const last = crumbs.length - 1
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 max-md:min-w-[6rem]">
      {crumbs.map((crumb, index) => {
        if (index === last) {
          return (
            <h1
              key={index}
              className={cn(
                'min-w-0 truncate text-heading font-semibold text-ink',
                crumb.mono && 'font-mono',
              )}
            >
              {/* The page you are on, so never a link, whatever `to` it was handed. */}
              {crumb.label}
            </h1>
          )
        }
        return (
          <Fragment key={index}>
            {crumb.to ? (
              <Link
                to={crumb.to}
                className={cn(
                  'flex-none text-data text-soft underline-offset-2 transition-colors hover:text-ink hover:underline max-md:hidden',
                  crumb.mono && 'font-mono',
                )}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={cn('flex-none text-data text-soft max-md:hidden', crumb.mono && 'font-mono')}
              >
                {crumb.label}
              </span>
            )}
            <ChevronRight className="size-3 flex-none text-faint max-md:hidden" aria-hidden />
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * The phone bar's way out of a detail page, in place of the ☰: `‹ Games`, naming where it
 * goes. Keeping both the ☰ and a back link squeezed the title to nothing, and the drawer is
 * one step away on the parent anyway. When the word no longer fits beside a title of at
 * least 6rem, it drops to the chevron alone and the name moves to its accessible label.
 */
function BackLink({ back }: { back: PageBack }) {
  const { t } = useLingui()
  const word = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)
  // The window width and label the word was last found not to fit at. A wider window or
  // another label starts from the word again, and the check below takes it back away if it
  // still does not fit — before paint, so the bar never shows the squeezed word.
  const at = `${width}|${back.label}`
  const [compactAt, setCompactAt] = useState<string | null>(null)
  const compact = compactAt === at

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useLayoutEffect(() => {
    const node = word.current
    // A measurement of the laid-out bar, which is only known after layout.
    if (!compact && node && node.scrollWidth > node.clientWidth + 1) setCompactAt(at)
  }, [compact, at])

  return (
    <Button
      asChild
      variant="ghost"
      size={compact ? 'icon-sm' : 'sm'}
      className={cn('min-w-0 shrink md:hidden', compact ? '-ml-1' : '-ml-1.5 gap-0.5 px-1.5')}
    >
      <Link to={back.to} aria-label={compact ? t`Back to ${back.label}` : undefined}>
        <ChevronLeft className="size-4 flex-none" aria-hidden />
        {compact ? null : (
          <span ref={word} className="min-w-0 truncate">
            {back.label}
          </span>
        )}
      </Link>
    </Button>
  )
}

/**
 * The 42px titlebar: the page's title, its own actions right-aligned, and then, past a
 * rule, the analysis queue and the Hide engine switch (the clarity pass, D3-A).
 * Thin, flat and on every screen — it carries a strong bottom rule and the chrome surface
 * rather than a hairline over the canvas. It starts at the rail's edge, and its left padding
 * is the page's gutter (`pl-6`, `PageBody`'s), so the title sits over the column it names.
 *
 * Most of what belongs to the app rather than to the page — the brand, the demo tint,
 * search, the account, the theme and the shortcuts — moved to the rail and the account
 * menu. The queue went down to the rail's foot too and came back: in 200px it lost its
 * word and, paused, its Clear, and the foot read as crammed (`QueueIndicator`). A bar holding both halves read as two toolbars run together, and the page's
 * buttons sat left, straight after its name, where they looked like more of the name.
 * Right-aligned, a page's actions end at the rule, and the rule is only drawn when there are
 * actions to end.
 *
 * The engine switch stays because it is a mode, not a screen's control: it has to be
 * reachable *before* a game is opened, which is the only moment at which hiding a verdict
 * is worth anything, and it keeps its place at every width.
 *
 * On a phone the bar spans the window (the rail is a drawer) and holds, in order: the ☰, or
 * on a detail page the back link that replaces it (`SetPageChrome`'s `back`); the title
 * alone, never under 6rem; the queue's figure (and Pause/Clear while they apply); the
 * engine switch without its word; and search as an icon,
 * since the rail's search field is behind the ☰. The page's actions stand in a row of their
 * own under the bar (`AppShell`'s `PhoneActions`).
 *
 * The horizontal padding is `max(…)` of the safe-area inset, so a landscape iPhone's notch
 * does not sit on the ☰; away from a notch every inset is 0. The `env()` fallbacks are
 * written `0rem` rather than `0px` because `lib/ui/scale.test.ts` bans a px length from a
 * Tailwind arbitrary value — at zero the two are the same length anyway.
 */
export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { breadcrumb, actions, back } = usePageChrome()
  const palette = useCommandPalette()
  const mobile = useIsMobile()
  const { t } = useLingui()
  const pageActions = actions && !mobile ? actions : null

  return (
    <header className="flex h-[calc(2.625rem+env(safe-area-inset-top,0rem))] flex-none items-center gap-2.5 border-b border-edge-strong bg-panel pt-[env(safe-area-inset-top,0rem)] pr-[max(0.75rem,env(safe-area-inset-right,0rem))] pl-[max(0.75rem,env(safe-area-inset-left,0rem))] select-none max-md:gap-2 md:pl-6">
      {back ? (
        <BackLink back={back} />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenNav}
          aria-label={t`Open the navigation`}
          className="-ml-1 md:hidden"
        >
          <Menu className="size-4" aria-hidden />
        </Button>
      )}
      <Trail crumbs={breadcrumb} />
      {pageActions ? (
        <>
          <div className="flex flex-none items-center gap-2">{pageActions}</div>
          <div className="h-[1.125rem] w-px flex-none bg-line" />
        </>
      ) : null}
      <QueueIndicator />
      <EngineToggle compact={mobile} />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={palette.open}
        aria-label={t`Search everything`}
        title={t`Search everything (⌘K)`}
        className="-mr-1 md:hidden"
      >
        <Search className="size-4" aria-hidden />
      </Button>
    </header>
  )
}
