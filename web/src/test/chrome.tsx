import { usePageChrome } from '@/components/shell/PageChrome'

/**
 * What a page put in the titlebar, drawn where a test can reach it. Pages have no heading of
 * their own: their buttons (`SetPageChrome`'s `actions`) are the shell's to draw, and a test
 * that mounts a page without the shell mounts this beside it instead. Inside the router,
 * since those buttons are often links.
 */
export function ChromeActions() {
  const { actions } = usePageChrome()
  return <div data-testid="titlebar">{actions}</div>
}

/** The page's breadcrumb, drawn the same way: its labels in order, for a test to read. */
export function ChromeCrumbs() {
  const { breadcrumb } = usePageChrome()
  return (
    <div data-testid="crumbs">
      {breadcrumb.map((crumb, index) => (
        <span key={index}>{crumb.label}</span>
      ))}
    </div>
  )
}
