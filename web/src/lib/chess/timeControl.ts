/**
 * A stored clock uses seconds for the base and seconds-per-move for the increment.
 * Chess UIs write the base in minutes: `300` is `5`, and `180+2` is `3+2`.
 * Non-numeric PGN clock formats are left intact rather than guessed at.
 */
export function formatClock(raw: string): string {
  const match = /^(\d+)(?:\+(\d+))?$/.exec(raw)
  if (!match) return raw

  const seconds = Number(match[1])
  const base = seconds % 60 === 0 ? String(seconds / 60) : String(Number((seconds / 60).toFixed(1)))
  return match[2] === undefined ? base : `${base}+${match[2]}`
}
