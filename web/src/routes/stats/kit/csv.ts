/**
 * "Export CSV" from design 2d.
 *
 * There is no export endpoint, and there does not need to be: every dimension the page has
 * loaded is already in hand, so the file is built in the browser. The shape is long rather
 * than wide — one row per (dimension, bucket, field) — because the dimensions do not share
 * a column set and a long table is what a spreadsheet pivots from anyway.
 */
import type { StatsResponse } from '@/lib/api/types'

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? '')
          return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
        })
        .join(','),
    )
    .join('\n')
}

/** Every bucket of every loaded dimension, totals included, as one flat table. */
export function exportRows(
  loaded: { dimension: string; data: StatsResponse | undefined }[],
): (string | number)[][] {
  const rows: (string | number)[][] = [['dimension', 'bucket', 'field', 'value']]
  for (const { dimension, data } of loaded) {
    if (!data) continue
    const entries = [...(data.buckets ?? []), ...(data.total ? [data.total] : [])]
    for (const bucket of entries) {
      for (const [field, value] of Object.entries(bucket)) {
        if (field === 'key' || typeof value !== 'number') continue
        rows.push([dimension, bucket.key, field, value])
      }
    }
  }
  return rows
}

/** Hands the file to the browser. Nothing to clean up but the object URL. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
