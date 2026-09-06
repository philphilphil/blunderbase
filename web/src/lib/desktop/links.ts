/**
 * Links that leave the page, in the desktop app.
 *
 * The app's webview has no tabs, and a `target="_blank"` link or a `window.open` is a
 * request for one. Left to the webview, that request goes nowhere: the shell's handler
 * for it (`on_new_window` in `lib.rs`) is in place, but on macOS WebKit never called it
 * for the links the app has, and the (?) in the titlebar and "Create one on lichess.org"
 * were dead in the desktop build. So while the native bridge is there the page does not
 * leave it to the webview: a click on such a link is taken over here and handed to the
 * shell, which opens the manual in a second window of the app and everything else in the
 * person's browser. In a browser there is no bridge and this never runs — the link is an
 * ordinary new tab.
 *
 * The click is taken in the bubbling phase on `document`, after React's own handlers on
 * the element have run, so the account menu still closes itself on the same click. A
 * click something else already cancelled is left alone.
 */
export function installDesktopLinks(open: (url: string) => void, target: Document = document): void {
  target.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (!(event.target instanceof Element)) return
    const anchor = event.target.closest('a[target="_blank"]')
    if (!(anchor instanceof HTMLAnchorElement) || !leavesThePage(anchor.href)) return
    event.preventDefault()
    open(anchor.href)
  })

  const view = target.defaultView
  if (!view) return
  view.open = (url) => {
    const href = url === undefined ? '' : String(url)
    if (leavesThePage(href)) open(href)
    return null
  }
}

function leavesThePage(href: string): boolean {
  return /^https?:\/\//i.test(href)
}
