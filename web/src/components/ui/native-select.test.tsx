import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NativeSelect, PickerSelect } from './native-select'

describe('NativeSelect', () => {
  it('is a sunk field like the inputs beside it', () => {
    render(
      <NativeSelect aria-label="Engine">
        <option>Stockfish</option>
      </NativeSelect>,
    )
    expect(screen.getByRole('combobox', { name: 'Engine' })).toHaveClass('bg-field', 'shadow-field')
  })
})

/** A toolbar's select wears the picker's face, with the real select laid over it. */
describe('PickerSelect', () => {
  const OPTIONS = [
    { value: 'fit', label: 'Fit (13)' },
    { value: '50', label: '50' },
  ] as const

  it('shows "Label: value" and hands the choice to the native control', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PickerSelect label="Rows" value="fit" options={OPTIONS} onChange={onChange} />)
    expect(screen.getByText('Rows:')).toBeInTheDocument()
    expect(screen.getAllByText('Fit (13)')[0]).toHaveClass('font-medium')
    const select = screen.getByRole('combobox', { name: 'Rows' })
    expect(select).toHaveClass('opacity-0')
    expect(select.parentElement).toHaveClass('bg-control', 'shadow-face')
    await user.selectOptions(select, '50')
    expect(onChange).toHaveBeenCalledWith('50')
  })

  it('lights while set and drops the face while disabled', () => {
    const { rerender } = render(
      <PickerSelect label="Rows" value="50" options={OPTIONS} onChange={() => {}} set />,
    )
    expect(screen.getByRole('combobox').parentElement).toHaveClass('bg-selected')
    rerender(<PickerSelect label="Rows" value="50" options={OPTIONS} onChange={() => {}} disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.getByRole('combobox').parentElement).toHaveClass('bg-transparent', 'text-faint-2')
  })

  it('draws a richer face with `display` and offers a disabled option greyed', () => {
    render(
      <PickerSelect
        label="Maia level"
        hideLabel
        size="strip"
        value="1500"
        display={<span>Maia 1500 and a mark</span>}
        options={[
          { value: '1500', label: 'Maia 1500' },
          { value: '1900', label: '1900 — re-analyse to add', disabled: true },
        ]}
        onChange={() => {}}
        testId="level"
      />,
    )
    expect(screen.getByTestId('level')).toHaveTextContent('Maia 1500 and a mark')
    expect(screen.getByRole('option', { name: '1900 — re-analyse to add' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Maia level' })).toHaveValue('1500')
  })
})
