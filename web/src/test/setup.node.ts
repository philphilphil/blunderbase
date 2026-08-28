// Setup for the tests that never touch a DOM. `setup.ts` pulls this in on top of the
// jsdom shims, so anything environment-agnostic belongs here rather than there.

// Every `toLocaleString` in the app leaves the locale to the machine, and assertions
// spell the result out ("1,042"). CI runs en-US, a German desktop groups that as
// "1.042", and the same suite passes on one and fails on the other. Pin the default so
// the tests read the same everywhere; a call that names its own locale still wins.
const LOCALE = 'en-US'

type Localizer = (locales?: Intl.LocalesArgument, options?: object) => string

function pinLocale<T extends object>(proto: T, method: keyof T) {
  const original = proto[method] as Localizer
  proto[method] = function pinned(this: unknown, locales?: Intl.LocalesArgument, options?: object) {
    return original.call(this, locales ?? LOCALE, options)
  } as T[keyof T]
}

pinLocale(Number.prototype, 'toLocaleString')
pinLocale(Date.prototype, 'toLocaleString')
pinLocale(Date.prototype, 'toLocaleDateString')
pinLocale(Date.prototype, 'toLocaleTimeString')

// Both are callable with and without `new`, and either way hand back a fresh formatter.
function pinConstructor<T extends Intl.NumberFormatConstructor | Intl.DateTimeFormatConstructor>(
  Original: T,
): T {
  const withLocale = (args: unknown[]) => [args[0] ?? LOCALE, args[1]]
  return new Proxy(Original, {
    construct: (target, args: unknown[]) => Reflect.construct(target, withLocale(args)),
    apply: (target, _this, args: unknown[]) => Reflect.construct(target, withLocale(args)),
  }) as T
}

Intl.NumberFormat = pinConstructor(Intl.NumberFormat)
Intl.DateTimeFormat = pinConstructor(Intl.DateTimeFormat)
