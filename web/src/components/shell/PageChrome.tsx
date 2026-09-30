import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/**
 * One step of the titlebar's trail: `Library › Import`, `Collections › League 2026`.
 *
 * The last crumb is the page's title. Every crumb before it is a place, so it carries its
 * `to` and the bar draws it as a link; something that is not a place (a date) belongs in the
 * page, not in the trail.
 */
export interface Crumb {
  label: ReactNode
  to?: string
  /** Render in mono, the way the design sets dates and IDs. */
  mono?: boolean
}

/**
 * The phone bar's way out of a detail page: `‹ Games` in place of the ☰, naming the page it
 * returns to (the game page's list, a correspondence game's list). Top-level pages and the
 * Stats reports leave it unset and keep the ☰.
 */
export interface PageBack {
  label: string
  to: string
}

export interface PageChromeValue {
  breadcrumb: Crumb[]
  /** The page's own buttons, right-aligned in the titlebar before the Hide engine switch. */
  actions: ReactNode
  /** Set by a detail page; see `PageBack`. */
  back: PageBack | null
  /**
   * The manual page this screen is written up in — `guide/analysis`, or
   * `guide/explorer#build-a-repertoire` for a heading inside one. The rail's Manual link
   * (`SideNav`) opens it; a page that sets nothing gets the manual's front page.
   */
  manual: string | null
}

interface ChromeStore extends PageChromeValue {
  set: (value: Partial<PageChromeValue>) => void
}

const PageChromeContext = createContext<ChromeStore | null>(null)

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<PageChromeValue>({
    breadcrumb: [],
    actions: null,
    back: null,
    manual: null,
  })
  const store = useMemo<ChromeStore>(
    () => ({
      ...value,
      set: (next) => setValue((current) => ({ ...current, ...next })),
    }),
    [value],
  )
  return <PageChromeContext.Provider value={store}>{children}</PageChromeContext.Provider>
}

function useChromeStore(): ChromeStore {
  const store = useContext(PageChromeContext)
  if (!store) throw new Error('page chrome used outside <PageChromeProvider>')
  return store
}

/** What the titlebar should render right now. Used by the shell, not by pages. */
export function usePageChrome(): PageChromeValue {
  const { breadcrumb, actions, back, manual } = useChromeStore()
  return { breadcrumb, actions, back, manual }
}

/**
 * Declared by a page to fill in the titlebar without touching the shell:
 *
 * ```tsx
 * <SetPageChrome
 *   breadcrumb={[{ label: t`Games`, to: libraryAddress }, { label: players }]}
 *   back={{ label: t`Games`, to: libraryAddress }}
 *   actions={<Button variant="secondary" size="sm">…</Button>}
 *   manual="guide/game"
 * />
 * ```
 *
 * The last crumb is the title (`text-heading`); the ones before it are places with a `to`.
 * `actions` stand right-aligned in the bar from `md` and in a row under it on a phone.
 * `back` is only for a detail page, and only the phone bar draws it.
 *
 * Renders nothing; the shell reads it out of context.
 */
export function SetPageChrome({
  breadcrumb,
  actions,
  back,
  manual,
}: {
  breadcrumb?: Crumb[]
  actions?: ReactNode
  back?: PageBack
  manual?: string
}) {
  const { set } = useChromeStore()
  // The identity of `breadcrumb` and `back` changes every render for an inline literal, so
  // the effect keys off their content instead.
  const signature = JSON.stringify([
    (breadcrumb ?? []).map((crumb) => [typeof crumb.label === 'string' ? crumb.label : '', crumb.to]),
    back ? [back.label, back.to] : null,
  ])

  // A layout effect rather than a passive one: the titlebar is then written before the
  // frame that shows the new page is painted, instead of one frame after it — a frame in
  // which the reader saw the new screen under the old screen's breadcrumb and buttons.
  useLayoutEffect(() => {
    set({
      breadcrumb: breadcrumb ?? [],
      actions: actions ?? null,
      back: back ?? null,
      manual: manual ?? null,
    })
    return () => set({ breadcrumb: [], actions: null, back: null, manual: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, actions, manual])

  return null
}
