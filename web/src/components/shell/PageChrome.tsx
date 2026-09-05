import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

/** One step of the titlebar breadcrumb: `Library / 22 Aug 2026 / kn1ghtmare — …`. */
export interface Crumb {
  label: ReactNode
  to?: string
  /** Render in mono, the way the design sets dates and IDs. */
  mono?: boolean
}

export interface PageChromeValue {
  breadcrumb: Crumb[]
  /** Buttons pinned into the titlebar, left of the queue widget. */
  actions: ReactNode
  /**
   * The manual page this screen is written up in — `guide/analysis`, or
   * `guide/explorer#build-a-repertoire` for a heading inside one. The titlebar turns it
   * into the (?) beside the breadcrumb; a page that sets nothing simply has no (?).
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
  const { breadcrumb, actions, manual } = useChromeStore()
  return { breadcrumb, actions, manual }
}

/**
 * Declared by a page to fill in the titlebar without touching the shell:
 *
 * ```tsx
 * <SetPageChrome
 *   breadcrumb={[{ label: 'Library', to: '/games' }, { label: title }]}
 *   manual="guide/game"
 * />
 * ```
 *
 * Renders nothing; the shell reads it out of context.
 */
export function SetPageChrome({
  breadcrumb,
  actions,
  manual,
}: {
  breadcrumb?: Crumb[]
  actions?: ReactNode
  manual?: string
}) {
  const { set } = useChromeStore()
  // The identity of `breadcrumb` changes every render for an inline array, so the effect
  // keys off its content instead.
  const signature = JSON.stringify(
    (breadcrumb ?? []).map((crumb) => [typeof crumb.label === 'string' ? crumb.label : '', crumb.to]),
  )

  useEffect(() => {
    set({ breadcrumb: breadcrumb ?? [], actions: actions ?? null, manual: manual ?? null })
    return () => set({ breadcrumb: [], actions: null, manual: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, actions, manual])

  return null
}
