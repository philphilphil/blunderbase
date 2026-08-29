import { describe, expect, it } from 'vitest'

import { cellClass, cellStyle, COLUMNS } from './columns'

function column(id: string) {
  const found = COLUMNS.find((entry) => entry.id === id)
  if (!found) throw new Error(`unknown column ${id}`)
  return found
}

describe('cell geometry', () => {
  it('hands a fixed width over as a custom property rather than setting it', () => {
    // An inline `width` outranks every class, so a cell that set one could not be re-laid
    // by the phone card — which is exactly the bug this shape exists to prevent.
    const style = cellStyle(column('opponent'))
    expect(style).not.toHaveProperty('width')
    expect(style).toMatchObject({ '--cell-width': '8.5rem' })
    expect(cellClass(column('opponent'))).toContain('md:w-[var(--cell-width)]')
  })

  it('leaves the last column flexible, which a grid item ignores anyway', () => {
    expect(cellStyle(column('flags'))).toEqual({ flex: 1, minWidth: 0 })
    expect(cellClass(column('flags'))).not.toContain('--cell-width')
  })
})
