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
}

interface ChromeStore extends PageChromeValue {
  set: (value: Partial<PageChromeValue>) => void
}

const PageChromeContext = createContext<ChromeStore | null>(null)

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<PageChromeValue>({ breadcrumb: [], actions: null })
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
  const { breadcrumb, actions } = useChromeStore()
  return { breadcrumb, actions }
}

/**
 * Declared by a page to fill in the titlebar without touching the shell:
 *
 * ```tsx
 * <SetPageChrome breadcrumb={[{ label: 'Library', to: '/games' }, { label: title }]} />
 * ```
 *
 * Renders nothing; the shell reads it out of context.
 */
export function SetPageChrome({
  breadcrumb,
  actions,
}: {
  breadcrumb?: Crumb[]
  actions?: ReactNode
}) {
  const { set } = useChromeStore()
  // The identity of `breadcrumb` changes every render for an inline array, so the effect
  // keys off its content instead.
  const signature = JSON.stringify(
    (breadcrumb ?? []).map((crumb) => [typeof crumb.label === 'string' ? crumb.label : '', crumb.to]),
  )

  useEffect(() => {
    set({ breadcrumb: breadcrumb ?? [], actions: actions ?? null })
    return () => set({ breadcrumb: [], actions: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, actions])

  return null
}
