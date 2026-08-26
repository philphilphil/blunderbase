/** The win / draw / loss bar design 2c uses at two sizes: 8px in the summary, 7px in a row.
 *  Heights are `rem` so the bar grows with the app's scale. */
import { cn } from '@/lib/utils'

import type { Split } from '../stats'

export function ScoreBar({
  split,
  className,
  height = '0.4375rem',
}: {
  split: Split
  className?: string
  height?: string
}) {
  const label = `${split.wins} wins, ${split.draws} draws, ${split.losses} losses`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ height }}
      className={cn('flex overflow-hidden rounded-[0.25rem] bg-raised', className)}
    >
      <span style={{ width: `${split.winPercent}%` }} className="bg-good" />
      <span style={{ width: `${split.drawPercent}%` }} className="bg-faint" />
      <span style={{ width: `${split.lossPercent}%` }} className="bg-blunder" />
    </span>
  )
}
