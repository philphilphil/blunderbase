/**
 * UCI options, as the probe declares them and as the editor has to hand them back.
 *
 * `POST /engines/probe` answers with what the binary said about itself during its
 * handshake (`backend/adapters/stockfish.py: UciOption.as_dict`), and every write path on
 * the backend re-validates against exactly that. Validating here first is not a second
 * source of truth: it is the same rules, applied before the round trip, so a typo is a
 * message under the field rather than a 422.
 */
import { t } from '@lingui/core/macro'

import type { ProbeOption, ProbeResponse } from '@/lib/api/types'

export type UciOptionType = 'check' | 'spin' | 'combo' | 'button' | 'string'

export interface DeclaredOption {
  name: string
  type: UciOptionType
  /** The engine's own default, already normalised out of UCI's `<empty>`. */
  default: string
  min: number | null
  max: number | null
  choices: string[]
  /**
   * Set per analysis by the engine driver (MultiPV, Ponder, UCI_Chess960 …). The backend
   * refuses to store one, so the editor shows it read-only rather than letting it fail.
   */
  managed: boolean
}

const TYPES: readonly UciOptionType[] = ['check', 'spin', 'combo', 'button', 'string']

/** UCI spells "no value" as `<empty>`; nobody wants to see that in a field. */
export function normalizeDefault(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = String(value)
  return text === '<empty>' ? '' : text
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** One probed option, in the shape the editor renders. */
export function toDeclared(option: ProbeOption): DeclaredOption {
  const type = String(option.type ?? 'string') as UciOptionType
  // `var` is the wire key (python-chess's own spelling), as `UciOption.as_dict` writes it.
  const choices: unknown = option.var ?? []
  return {
    name: String(option.name ?? ''),
    type: TYPES.includes(type) ? type : 'string',
    default: normalizeDefault(option.default),
    min: toNumber(option.min),
    max: toNumber(option.max),
    choices: Array.isArray(choices) ? choices.map((choice) => String(choice)) : [],
    managed: option.managed === true,
  }
}

export function declaredOptions(probe: ProbeResponse | undefined): DeclaredOption[] {
  return (probe?.options ?? []).map(toDeclared).filter((option) => option.name !== '')
}

export function findDeclared(
  options: DeclaredOption[],
  name: string,
): DeclaredOption | undefined {
  const folded = name.toLowerCase()
  return options.find((option) => option.name.toLowerCase() === folded)
}

/** Whether the editor lets a value be typed at all. */
export function isEditable(option: DeclaredOption): boolean {
  return !option.managed && option.type !== 'button'
}

/**
 * Why this text is not a value for this option, or null if it is one. An empty string
 * always passes: it means "leave the engine's own default alone".
 */
export function optionError(option: DeclaredOption, raw: string): string | null {
  const value = raw.trim()
  if (value === '') return null
  if (option.managed) return t`set per analysis — it cannot be stored`
  if (option.type === 'button') return t`a button is an action, not a stored value`

  switch (option.type) {
    case 'check':
      return value === 'true' || value === 'false' ? null : t`has to be true or false`
    case 'spin': {
      if (!/^-?\d+$/.test(value)) return t`has to be a whole number`
      const parsed = Number.parseInt(value, 10)
      const { min, max } = option
      if (min !== null && parsed < min) return t`at least ${min}`
      if (max !== null && parsed > max) return t`at most ${max}`
      return null
    }
    case 'combo': {
      if (option.choices.length === 0) return null
      const choices = option.choices.join(', ')
      return option.choices.includes(value) ? null : t`one of ${choices}`
    }
    default:
      return null
  }
}

/** The typed value the API stores, from the text the field holds. */
export function parseOption(option: DeclaredOption, raw: string): unknown {
  const value = raw.trim()
  switch (option.type) {
    case 'check':
      return value === 'true'
    case 'spin':
      return Number.parseInt(value, 10)
    default:
      return value
  }
}

/** A stored option value, as its field shows it. */
export function toFieldValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export interface OptionDraft {
  /** Every editable option's current text, keyed by the engine's own spelling. */
  values: Record<string, string>
}

/** The stored options as an editor draft: everything the engine has, nothing it has not. */
export function draftFrom(stored: Record<string, unknown> | undefined): OptionDraft {
  const values: Record<string, string> = {}
  for (const [name, value] of Object.entries(stored ?? {})) {
    values[name] = toFieldValue(value)
  }
  return { values }
}

export interface DraftResult {
  /** Field name -> why it is wrong. Empty when the draft can be saved. */
  errors: Record<string, string>
  /** What `PATCH /engines/{id}` should be sent, or undefined while anything is wrong. */
  options?: Record<string, unknown>
  /** Whether it differs from what is stored — the Save button's enabled state. */
  changed: boolean
}

/**
 * The draft, validated and reduced to a payload.
 *
 * A field left empty is left out entirely rather than sent as `""`: an option nobody set
 * is the engine's own default, and storing the default would freeze it against a future
 * version of the binary. A field that repeats the declared default is kept only when it
 * was already stored, so opening the editor and saving it unchanged is a no-op.
 */
export function resolveDraft(
  declared: DeclaredOption[],
  draft: OptionDraft,
  stored: Record<string, unknown> | undefined,
): DraftResult {
  const errors: Record<string, string> = {}
  const options: Record<string, unknown> = {}
  const current = stored ?? {}

  for (const [name, raw] of Object.entries(draft.values)) {
    const option = findDeclared(declared, name)
    if (!option) {
      // Kept, not dropped: an option the probe no longer declares is a real problem the
      // person has to see, and the backend would refuse the write anyway.
      errors[name] = t`this engine does not declare that option`
      continue
    }
    const problem = optionError(option, raw)
    if (problem) {
      errors[name] = problem
      continue
    }
    const value = raw.trim()
    if (value === '') continue
    const wasStored = Object.hasOwn(current, option.name)
    if (!wasStored && value === option.default) continue
    options[option.name] = parseOption(option, value)
  }

  const changed = JSON.stringify(sorted(options)) !== JSON.stringify(sorted(current))
  if (Object.keys(errors).length > 0) return { errors, changed }
  return { errors, options, changed }
}

function sorted(values: Record<string, unknown>): [string, unknown][] {
  return Object.entries(values).sort(([left], [right]) => left.localeCompare(right))
}
