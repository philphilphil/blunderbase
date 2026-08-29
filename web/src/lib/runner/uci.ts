/**
 * The UCI text a Stockfish build speaks, as pure functions over strings.
 *
 * It is its own file because the server *validates against it*. A runner's advertisement
 * carries `declared_options`, and `services/engines.validate_options` checks every stored
 * option against that list — so a browser tab whose handshake parser disagrees with
 * python-chess's by one field is a tab whose engine is refused, or worse, accepted with an
 * option the engine never declared. `parseOption` is therefore a deliberate port of
 * python-chess's own `UciProtocol._option` (its keyword-split regex, its `Option.parse`
 * coercion and its `MANAGED_OPTIONS` list), not a fresh reading of the UCI spec — the
 * point is to produce the same records the Python runner would have produced from the same
 * lines, down to `default "<empty>"` staying the literal string python-chess makes of it.
 *
 * Nothing here knows about chess. Legality, castling spellings and PV truncation need a
 * board and live in `engine.ts`.
 */

/** One option the engine declared, exactly `adapters/stockfish.py: UciOption.as_dict()`. */
export interface UciOption {
  name: string
  type: string
  default: string | number | boolean | null
  min: number | null
  max: number | null
  var: string[]
  /** python-chess sets these per call, so a stored value would be ignored. */
  managed: boolean
}

/** `chess.engine.MANAGED_OPTIONS`, verbatim. Compared case-insensitively, as it is there. */
export const MANAGED_OPTIONS = ['uci_chess960', 'uci_variant', 'multipv', 'ponder']

/** The score half of an `info` line. cp and mate arrive as a pair and are merged as one. */
export interface InfoScore {
  cp: number | null
  mate: number | null
  /**
   * `lowerbound` or `upperbound`: the engine saying "at least this much" mid-window rather
   * than reporting an evaluation. python-chess records the two flags and otherwise ignores
   * them; `snapshots.ts` drops the line, because showing one makes an analysis board
   * flicker between numbers the engine never meant.
   */
  bounded: boolean
}

/**
 * What one `info` line said, of the fields an analysis reads. A field the line did not
 * mention is null (or, for the PV, null rather than an empty list) — the caller merges
 * successive lines the way python-chess's `AnalysisResult._register` does, so "absent" and
 * "absent but previously known" have to stay distinguishable.
 */
export interface InfoLine {
  depth: number | null
  multipv: number | null
  nodes: number | null
  /** Nodes per second, as the engine counts them. */
  nps: number | null
  /**
   * `time`, in the milliseconds UCI writes it in. python-chess divides it into seconds and
   * `adapters/infinite.py` multiplies it back for the snapshot; the round trip has no
   * reader in between, so it is kept in the unit the wire and the snapshot both use.
   */
  timeMs: number | null
  score: InfoScore | null
  pv: string[] | null
}

// The keyword split python-chess uses. `String.split` with a capturing group keeps the
// separators, the way `re.split` does, so the loop below can stay a transcription.
const OPTION_SPLIT = /\s*(\bname\b|\btype\b|\bdefault\b|\bmin\b|\bmax\b|\bvar\b)\s*/

/**
 * One `option name … type … default …` line as the record an advertisement carries, or
 * null when the line is not an option at all.
 */
export function parseOption(line: string): UciOption | null {
  const text = line.trim()
  if (!text.startsWith('option ')) return null

  const parts: Record<string, string> = { name: '', type: '', default: '', min: '', max: '' }
  const vars: string[] = []
  let current: string | null = null
  for (const token of text.slice('option '.length).trim().split(OPTION_SPLIT)) {
    if (token === 'var' || (token in parts && !parts[token])) {
      current = token
    } else if (current === 'var') {
      vars.push(token)
    } else if (current) {
      parts[current] = token
    }
  }
  if (!parts.name) return null

  const min = wholeNumber(parts.min)
  const max = wholeNumber(parts.max)
  return {
    name: parts.name,
    type: parts.type,
    default: parseDefault(parts.type, parts.default, min, max),
    min,
    max,
    var: vars,
    managed: MANAGED_OPTIONS.includes(parts.name.toLowerCase()),
  }
}

/** The engine's own name, off an `id name …` line. */
export function parseIdName(line: string): string | null {
  const found = /^id\s+name\s+(.+)$/.exec(line.trim())
  return found ? found[1].trim() : null
}

/**
 * One `info` line, or null when there is nothing on it worth keeping.
 *
 * `info string …` is the engine talking to a log and is dropped outright — it is the one
 * `info` shape whose remaining words are prose and would otherwise be read as fields.
 */
export function parseInfo(line: string): InfoLine | null {
  const tokens = line.trim().split(/\s+/)
  if (tokens[0] !== 'info' || tokens[1] === 'string') return null

  const info: InfoLine = {
    depth: null,
    multipv: null,
    nodes: null,
    nps: null,
    timeMs: null,
    score: null,
    pv: null,
  }
  for (let at = 1; at < tokens.length; at += 1) {
    const token = tokens[at]
    if (token === 'pv') {
      info.pv = tokens.slice(at + 1)
      break
    }
    if (token === 'score') {
      // `score cp 35`, `score mate -2`, either optionally followed by `lowerbound` or
      // `upperbound`, which arrive as their own tokens below.
      const kind = tokens[at + 1]
      const value = wholeNumber(tokens[at + 2])
      if (kind === 'cp') info.score = { cp: value, mate: null, bounded: false }
      else if (kind === 'mate') info.score = { cp: null, mate: value, bounded: false }
      at += 2
      continue
    }
    if (token === 'lowerbound' || token === 'upperbound') {
      if (info.score !== null) info.score.bounded = true
      continue
    }
    if (token === 'depth' || token === 'multipv' || token === 'nodes' || token === 'nps') {
      info[token] = wholeNumber(tokens[at + 1])
      at += 1
      continue
    }
    if (token === 'time') {
      info.timeMs = wholeNumber(tokens[at + 1])
      at += 1
    }
  }
  return info
}

/**
 * Whether a line is the `bestmove …` that ends a search.
 *
 * The move it names is deliberately not read: the first choice is rank 1's first PV move,
 * already legality-checked against the searched position, and `bestmove (none)` on a
 * finished position would otherwise look like a move that failed to parse.
 */
export function isBestMoveLine(line: string): boolean {
  return /^bestmove\b/.test(line.trim())
}

/**
 * `Option.parse` of the declared default, so the record matches what a probe on the Python
 * side would have held.
 *
 * The one place this is deliberately gentler than python-chess: a spin or a combo whose
 * default does not parse raises there and takes the whole handshake with it. Here it
 * becomes a null default. A tab that refused to start an engine over the default of an
 * option nobody sets would be worse than one that advertises the option without it.
 */
function parseDefault(
  type: string,
  raw: string,
  min: number | null,
  max: number | null,
): string | number | boolean | null {
  switch (type) {
    case 'check':
      // `value and value != "false"` — an absent default stays the empty string it was.
      return raw === '' ? '' : raw !== 'false'
    case 'spin': {
      const value = wholeNumber(raw)
      if (value === null) return null
      if (min !== null && value < min) return null
      if (max !== null && value > max) return null
      return value
    }
    case 'button':
    case 'reset':
    case 'save':
      return null
    default:
      // string, file, path, combo, and anything a future build invents: the text verbatim,
      // which is why `default <empty>` is stored as `"<empty>"` and not as `""`.
      return raw
  }
}

function wholeNumber(text: string | undefined): number | null {
  if (text === undefined || text === '') return null
  // `Number` rather than `parseInt`: `12abc` is a malformed field, not the number twelve.
  const value = Number(text)
  return Number.isInteger(value) ? value : null
}
