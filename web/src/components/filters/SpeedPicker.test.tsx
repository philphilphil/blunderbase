import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { SpeedPicker } from './SpeedPicker'

const SPEEDS = ['bullet', 'blitz', 'rapid', 'classical'] as const
type Speed = (typeof SPEEDS)[number]

function Harness({ initial = [...SPEEDS] }: { initial?: Speed[] }) {
  const [value, setValue] = useState<Speed[]>(initial)
  return <SpeedPicker speeds={SPEEDS} value={value} onChange={setValue} />
}

/** The one Speed control: "Speed: All" until it narrows, a checklist that never empties. */
describe('SpeedPicker', () => {
  it('reads "Speed: All" unlit while every speed is on', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: /^Speed:\s*All$/ })
    expect(trigger).not.toHaveClass('bg-selected')
  })

  it('narrows from its checklist and names what is left, lit', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /^Speed/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Bullet' }))
    await user.click(screen.getByRole('checkbox', { name: 'Classical' }))
    expect(screen.getByRole('checkbox', { name: 'Bullet' })).toHaveAttribute('aria-checked', 'false')
    const trigger = screen.getByRole('button', { name: /^Speed:\s*Blitz, Rapid$/ })
    expect(trigger.closest('[data-set]')).toHaveClass('bg-selected')
  })

  it('carries a count per speed and can hang its panel from its right edge', async () => {
    const user = userEvent.setup()
    render(
      <SpeedPicker
        speeds={SPEEDS}
        value={[...SPEEDS]}
        onChange={() => {}}
        counts={{ bullet: 970, blitz: 1144 }}
        align="end"
      />,
    )
    await user.click(screen.getByRole('button', { name: /^Speed/ }))
    expect(screen.getByText('1,144')).toBeInTheDocument()
    const panel = screen.getByRole('checkbox', { name: 'Bullet' }).closest('.bb-pop-in')
    expect(panel).toHaveClass('md:right-0', 'md:left-auto')
  })

  it('never empties the set, and the clear puts every speed back', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['blitz']} />)
    await user.click(screen.getByRole('button', { name: /^Speed/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Blitz' }))
    expect(screen.getByRole('checkbox', { name: 'Blitz' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Clear Speed filter' }))
    expect(screen.getByRole('button', { name: /^Speed:\s*All$/ })).toBeInTheDocument()
  })
})
