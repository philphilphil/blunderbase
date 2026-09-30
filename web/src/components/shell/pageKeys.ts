/**
 * ⌘1–⌘6: the pages with a number, in one table read by the key handler (`AppShell`), the
 * rail's row titles (`SideNav`) and the palette's page rows (`CommandPalette`). One table,
 * so a number printed beside a page is always the number that opens it.
 *
 * The numbers are the order the pages arrived in, not the rail's order: Collections came
 * sixth and sits beside Games in the rail, and a number learned for Explorer or Stats keeps
 * meaning what it meant.
 */
export const PAGE_KEYS: Readonly<Record<string, string>> = {
  '/': '1',
  '/games': '2',
  '/explorer': '3',
  '/notes': '4',
  '/stats': '5',
  '/collections': '6',
}

/** The chord that opens `path`, as it is printed ("⌘2"), or undefined for a page without one. */
export function pageKeyHint(path: string): string | undefined {
  const key = PAGE_KEYS[path]
  return key ? `⌘${key}` : undefined
}

/** The page a number opens, the other way round, for the key handler. */
export function pageForKey(key: string): string | undefined {
  return Object.entries(PAGE_KEYS).find(([, value]) => value === key)?.[0]
}
