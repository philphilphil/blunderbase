import { Trans, useLingui } from '@lingui/react/macro'
import {
  Bot,
  CalendarDays,
  ChevronUp,
  CircleHelp,
  Compass,
  KeyRound,
  Keyboard,
  Languages,
  LogOut,
  Palette,
  Settings,
  Users,
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { useLogout } from '@/lib/api/queries'
import { useLocale } from '@/lib/i18n/I18nProvider'
import { LOCALE_NAMES, LOCALES, type Locale } from '@/lib/i18n/locale'
import { REPO_URL } from '@/lib/links'
import { manualUrl } from '@/lib/manual'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'
import { useTour } from '@/lib/tour/TourProvider'
import { cn } from '@/lib/utils'
import { VERSION_LABEL } from '@/lib/version'
import { ChangePasswordDialog } from '@/routes/auth'

import { usePageChrome } from './PageChrome'
import { useShortcutsOverlay } from './ShortcutsOverlay'
import { DateFormatPicker } from './DateFormatPicker'
import { ThemeToggle } from './ThemeToggle'

/**
 * The GitHub mark, drawn here rather than imported: lucide-react 1.x dropped its brand
 * icons, so this is lucide's own `github` glyph inlined in the same stroke idiom as the rest.
 */
function Github({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  )
}

const ITEM =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-label text-soft transition-colors hover:bg-raised hover:text-ink focus-visible:outline-offset-[-0.125rem]'

/** The menu's commands, which the arrow keys walk. */
const MENU_ITEM = '[role="menuitem"]:not([disabled])'

/** What opening the menu puts the focus on: the first control in it. */
const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), a[href], [tabindex]:not([tabindex="-1"])'

/** A setting row: its name on the left, the `Segmented` that sets it on the right. */
const FIELD = 'flex items-center gap-2 py-1 pr-1 pl-2 text-label text-soft'

/** Where the menu stands: its bottom-left corner a step above the trigger's top-left. */
function placeAbove(trigger: HTMLElement | null): CSSProperties {
  if (!trigger) return {}
  const rect = trigger.getBoundingClientRect()
  return { left: Math.max(rect.left, 8), bottom: window.innerHeight - rect.top + 4 }
}

/**
 * Settings, at the bottom of the rail: a gear, the word and a `⌃`, as one row
 * (`variant="row"`), or the gear alone in the folded rail (`variant="icon"`). It opens the
 * menu upward, because it is the last thing in its column; `⌃` rather than the picker's `⇅`,
 * since this opens a menu of things to do and not a value to choose.
 *
 * A gear and not a person. It used to be the owner's initials and name, borrowed from a
 * connected chess account — but Blunderbase has no user of its own: one library, one owner,
 * and on the desktop not even a sign-in. With two accounts the row had to pick a name, with
 * none it said "Account", and nothing in the menu was about a person anyway. Who the owner
 * plays as is said where it decides something: Mine / Others, the bold name in a row, and
 * Library › Accounts.
 *
 * The menu holds everything about the installation rather than about the games, in the
 * order it is reached for: the settings set once and left (Appearance and Language, each
 * the app's one `Segmented`, and the date format, a picker since six dates do not fit
 * across) and the keyboard shortcuts; the ways into the installation
 * (the accounts the library is made of, the MCP setup); help (this page's chapter of the
 * manual, the tour); the session (changing the password, signing out, only where there is
 * one); and last, as small print, the build's version with what changed and the source. The
 * manual, the source link and the version used to be a row of their own under the rail;
 * they are once-in-a-while things, which is what this menu is for. Each language is named in
 * itself, so the row is legible whatever the page currently speaks.
 *
 * The menu is portalled and fixed rather than hung off the trigger: the rail clips what
 * overflows it (its fold animates its width), and the menu is wider than the rail.
 */
export function SettingsMenu({ variant = 'row' }: { variant?: 'row' | 'icon' }) {
  const capabilities = useRuntimeCapabilities()
  const { manual } = usePageChrome()
  const logout = useLogout()
  const tour = useTour()
  const shortcuts = useShortcutsOverlay()
  const { t } = useLingui()
  const { locale, setLocale } = useLocale()
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const [place, setPlace] = useState<CSSProperties>({})
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const label = t`Settings`

  useLayoutEffect(() => {
    if (open) setPlace(placeAbove(trigger.current))
  }, [open])

  // Portalled to the end of the page, the menu is not next in the tab order after its
  // trigger, so opening it moves the focus in (onto the first control, Appearance) and
  // Escape hands it back, as `ActionMenu` does for a menu that hangs off its trigger.
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (trigger.current?.contains(target) || menu.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const close = () => setOpen(false)

  // The arrows walk the menu's items, as a `role=menu` promises; Tab walks every control in
  // it, the settings' segments included, and leaving it by Tab closes it rather than
  // leaving it open over the page behind the focus.
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    // A select's arrows are its own: on Windows and in Firefox they step through its options.
    if (event.target instanceof HTMLSelectElement) return
    const items =Array.from(menu.current?.querySelectorAll<HTMLElement>(MENU_ITEM) ?? [])
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = at === -1 ? (step === 1 ? 0 : items.length - 1) : at + step
    event.preventDefault()
    items[(next + items.length) % items.length]?.focus()
  }
  const onMenuBlur = (event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget as Node | null
    if (!to || menu.current?.contains(to) || trigger.current?.contains(to)) return
    setOpen(false)
  }

  return (
    <>
      {variant === 'row' ? (
        <Button
          ref={trigger}
          variant="ghost"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((was) => !was)}
          className="group h-7 min-w-0 flex-1 justify-start gap-2 px-1 text-left aria-expanded:bg-raised"
        >
          <Settings className="size-3.5 flex-none text-dim group-hover:text-ink" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-data font-normal text-body group-hover:text-ink">
            {label}
          </span>
          <ChevronUp className="size-3 flex-none text-dim" aria-hidden />
        </Button>
      ) : (
        <Button
          ref={trigger}
          variant="ghost"
          size="icon-sm"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={label}
          title={label}
          onClick={() => setOpen((was) => !was)}
          className="text-dim aria-expanded:bg-raised"
        >
          <Settings className="size-3.5" aria-hidden />
        </Button>
      )}

      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={label}
              onKeyDown={onMenuKeyDown}
              onBlur={onMenuBlur}
              style={place}
              className="bb-card fixed z-[60] flex w-[20rem] max-w-[calc(100vw-1rem)] flex-col gap-0.5 p-1 shadow-[0_0.75rem_2rem_var(--bb-shadow)]"
            >
              <div className={FIELD}>
                <span className="inline-flex flex-1 items-center gap-2 whitespace-nowrap">
                  <Palette className="size-3.5" aria-hidden />
                  <Trans>Appearance</Trans>
                </span>
                <ThemeToggle />
              </div>
              <div className={FIELD}>
                <span className="inline-flex flex-1 items-center gap-2 whitespace-nowrap">
                  <Languages className="size-3.5" aria-hidden />
                  <Trans>Language</Trans>
                </span>
                <Segmented<Locale>
                  label={t`Language`}
                  size="xs"
                  value={locale}
                  onChange={(next) => void setLocale(next)}
                  options={LOCALES.map((option) => ({
                    value: option,
                    label: <span lang={option}>{LOCALE_NAMES[option]}</span>,
                  }))}
                />
              </div>
              <div className={FIELD}>
                <span className="inline-flex flex-1 items-center gap-2 whitespace-nowrap">
                  <CalendarDays className="size-3.5" aria-hidden />
                  <Trans>Date format</Trans>
                </span>
                <DateFormatPicker />
              </div>
              {/*
                The row prints its key, so opening the list once teaches the `?` that opens
                it from anywhere without the menu.
              */}
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={() => {
                  close()
                  shortcuts.open()
                }}
              >
                <Keyboard className="size-3.5" aria-hidden />
                <span className="flex-1">
                  <Trans>Keyboard shortcuts</Trans>
                </span>
                <kbd className="rounded-sm bg-chip-neutral px-[0.3125rem] font-mono text-meta text-dim">
                  ?
                </kbd>
              </button>
              <div className="my-0.5 h-px bg-hairline" />

              {/* The chess accounts this library is made of: what decides "mine". */}
              <Link to="/library/import" role="menuitem" className={ITEM} onClick={close}>
                <Users className="size-3.5" aria-hidden />
                <Trans>Connected accounts</Trans>
              </Link>
              {capabilities.mcp ? (
                <Link to="/assistant" role="menuitem" className={ITEM} onClick={close}>
                  <Bot className="size-3.5" aria-hidden />
                  <Trans>Assistant</Trans>
                </Link>
              ) : null}
              <div className="my-0.5 h-px bg-hairline" />

              {/*
                The manual at the chapter the page names (`SetPageChrome`'s `manual`), or at
                its front page when it names none, in the language the app is in. A new tab:
                the manual is a separate site served beside the app, and the reader is
                mid-task, looking something up about the page they will come back to.
              */}
              <a
                href={manualUrl(locale, manual ?? '')}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                className={ITEM}
                onClick={close}
              >
                <CircleHelp className="size-3.5" aria-hidden />
                {manual ? <Trans>Manual for this page</Trans> : <Trans>Manual</Trans>}
              </a>
              {/*
                Beside it, because it answers the same kind of question one screen earlier:
                the manual explains what the engines do, the tour says what the screens are.
                The tour runs once by itself on a fresh installation and this is the only way
                back to it.
              */}
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={() => {
                  close()
                  tour.replay()
                }}
              >
                <Compass className="size-3.5" aria-hidden />
                <Trans>Show the tour again</Trans>
              </button>
              {capabilities.password_auth ? (
                <>
                  <div className="my-0.5 h-px bg-hairline" />
                  <button
                    type="button"
                    role="menuitem"
                    className={ITEM}
                    onClick={() => {
                      close()
                      setChanging(true)
                    }}
                  >
                    <KeyRound className="size-3.5" aria-hidden />
                    <Trans>Change password</Trans>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={cn(ITEM, 'hover:text-blunder')}
                    disabled={logout.isPending}
                    onClick={() => {
                      close()
                      logout.mutate()
                    }}
                  >
                    <LogOut className="size-3.5" aria-hidden />
                    <Trans>Sign out</Trans>
                  </button>
                </>
              ) : null}
              {/*
                Small print, last: which build this is, a link to what changed in it, and the
                source. Metadata rather than commands, so `meta` in `dim-2` like every figure.
              */}
              <div className="mt-0.5 flex items-center gap-2 border-t border-hairline px-2 pt-1.5 pb-1 text-meta text-dim-2">
                <a
                  href={`${REPO_URL}/blob/main/CHANGELOG.md`}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  onClick={close}
                  className="rounded-sm text-dim-2 transition-colors hover:text-ink"
                  title={t`Blunderbase ${VERSION_LABEL} — what changed`}
                >
                  Blunderbase <span className="font-mono">{VERSION_LABEL}</span>
                  {' · '}
                  <Trans>What changed</Trans>
                </a>
                <span className="flex-1" />
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  onClick={close}
                  aria-label={t`Blunderbase on GitHub`}
                  title={t`Blunderbase on GitHub`}
                  className="flex items-center rounded-sm text-dim-2 transition-colors hover:text-ink"
                >
                  <Github className="size-3.5" />
                </a>
              </div>
            </div>,
            document.body,
          )
        : null}

      {capabilities.password_auth && changing ? (
        <ChangePasswordDialog onClose={() => setChanging(false)} />
      ) : null}
    </>
  )
}
