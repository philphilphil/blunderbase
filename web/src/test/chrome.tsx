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
