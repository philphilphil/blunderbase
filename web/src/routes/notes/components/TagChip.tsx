/**
 * A note's tag, which narrows the list to that tag when pressed: in the stream and sheet
 * cards and in the list's rows alike, so the three views cannot disagree about what a tag
 * looks like or does.
 *
 * A chip (docs/design/README.md, "Controls"): a border with no face, lighter than a button
 * because several sit in a row, and the border lifting on hover the way `FilterChip`'s does.
 * Not a `FilterChip` itself, because a tag has no on state to show: pressing it adds a
 * filter above the list, it does not light here. A faint leading `#` says "tag" before the
 * pointer arrives. Now that the note's kind ("game", "loose") is flat text beside it, the
 * tags are the only bordered things on a card, so the fact and the control never share a
 * shape (the clarity pass).
 */
import { useLingui } from '@lingui/react/macro'

import { cn } from '@/lib/utils'

export function TagChip({
  tag,
  onClick,
  className,
}: {
  tag: string
  /** Narrows the list to the tag; without it the chip is drawn but cannot be pressed. */
  onClick?: (tag: string) => void
  className?: string
}) {
  const { t } = useLingui()
  return (
    <button
      type="button"
      onClick={() => onClick?.(tag)}
      disabled={!onClick}
      title={onClick ? t`Show only notes tagged ${tag}` : undefined}
      className={cn(
        'group/tag inline-flex h-5 flex-none items-center gap-px rounded-sm border border-edge pr-1.5 pl-[0.3125rem] text-meta text-soft transition-colors enabled:hover:border-edge-hover enabled:hover:text-ink',
        className,
      )}
    >
      <span aria-hidden className="text-faint group-hover/tag:text-dim">
        #
      </span>
      {tag}
    </button>
  )
}
