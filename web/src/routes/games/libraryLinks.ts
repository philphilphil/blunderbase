/**
 * Links into the library from outside the table — the rail's saved filters and "Your
 * lines", the command palette — and how they sit beside the library's own address.
 *
 * The library's URL carries two kinds of thing: the filters, which say *which* games (what a
 * saved filter is), and the view — sort and page — which says how the reader is looking at
 * them (`./sorting`, `./paging`). A link from outside names only filters. So a saved filter
 * is still the one on screen after the reader re-sorts it or turns a page, and following
 * one while already reading the library keeps the order the reader chose: before the sort
 * moved into the address it lived in the mounted table and survived such a click, and a
 * link should not quietly throw it away now. The page is not carried — a new cut starts at
 * its first page, as a filter change inside the table does.
 */

const LIBRARY = '/games'
const SORT_PARAMS = ['order', 'direction'] as const
const VIEW_PARAMS = new Set<string>([...SORT_PARAMS, 'page'])

/** `params` without the sort and the page: only what says which games. */
function cutOf(params: URLSearchParams): Map<string, string[]> {
  const cut = new Map<string, string[]>()
  for (const [key, value] of params) {
    if (VIEW_PARAMS.has(key)) continue
    cut.set(key, [...(cut.get(key) ?? []), value])
  }
  return cut
}

/**
 * Whether the library at `search` is showing exactly the cut `filters` names and nothing
 * more, however it is sorted and whichever page it is on.
 */
export function showsCut(filters: URLSearchParams, search: string): boolean {
  const wanted = cutOf(filters)
  const shown = cutOf(new URLSearchParams(search))
  if (wanted.size !== shown.size) return false
  for (const [key, values] of wanted) {
    const other = shown.get(key)
    if (!other || other.length !== values.length) return false
    if (values.some((value, i) => other[i] !== value)) return false
  }
  return true
}

/**
 * `to`, with the library's current sort carried onto it when it leads into the library
 * and the reader is already there (`pathname`/`search` are where they are now). Anything
 * else — another screen, a link that names its own sort — is returned as it was.
 */
export function carrySort(to: string, pathname: string, search: string): string {
  if (pathname !== LIBRARY) return to
  const mark = to.indexOf('?')
  const path = mark === -1 ? to : to.slice(0, mark)
  if (path !== LIBRARY) return to
  const target = new URLSearchParams(mark === -1 ? '' : to.slice(mark + 1))
  if (SORT_PARAMS.some((key) => target.has(key))) return to
  const current = new URLSearchParams(search)
  let carried = false
  for (const key of SORT_PARAMS) {
    const value = current.get(key)
    if (value === null) continue
    target.set(key, value)
    carried = true
  }
  return carried ? `${LIBRARY}?${target.toString()}` : to
}
