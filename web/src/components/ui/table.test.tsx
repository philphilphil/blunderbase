import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SortableHead, Table, TableBody, TableCell, TableHeader, TableRow } from './table'

function table(sorted: 'asc' | 'desc' | false, onSort = vi.fn()) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead sorted={sorted} onSort={onSort}>
            Date
          </SortableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow data-state="selected">
          <TableCell>row</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

describe('SortableHead', () => {
  it('is a column head whose whole cell sorts, and says how it is sorted', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    const { rerender } = render(table(false, onSort))
    const head = screen.getByRole('columnheader', { name: 'Date' })
    expect(head).toHaveAttribute('aria-sort', 'none')
    const button = screen.getByRole('button', { name: 'Date' })
    expect(button).toHaveClass('text-soft', 'uppercase')
    await user.click(button)
    expect(onSort).toHaveBeenCalledOnce()
    rerender(table('desc', onSort))
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('button', { name: 'Date' })).toHaveClass('text-ink')
  })
})

describe('TableRow', () => {
  it('marks a selected row with the fill and the accent bar, unchanged on hover', () => {
    render(table(false))
    const row = screen.getByRole('row', { name: 'row' })
    expect(row).toHaveClass(
      'data-[state=selected]:bg-selected',
      'data-[state=selected]:shadow-row-bar',
      'data-[state=selected]:hover:bg-selected',
    )
  })
})
