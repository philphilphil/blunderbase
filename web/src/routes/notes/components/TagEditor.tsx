/**
 * The tag box: chips that can be taken off, and one input that adds another.
 *
 * The suggestions come from `GET /notes/tags`, which is every tag already in use with how
 * many notes carry it — offered through a native `<datalist>` so the list behaves like the
 * browser's own completion and needs no floating panel of its own.
 */
import { useId, useState } from 'react'

import { cn } from '@/lib/utils'

export interface TagEditorProps {
  tags: string[]
  onChange: (next: string[]) => void
  /** Every tag in use, for completion. */
  suggestions?: string[]
  placeholder?: string
  className?: string
  /** Announced on the input — a note's tags, or a filter's. */
  label?: string
}

/**
 * Trimmed, and nothing else: the backend's `normalize_tags` keeps the writer's case and
 * folds only for de-duplication, so lower-casing or hyphenating here would invent a second
 * vocabulary and `Endgame` written on the game page would come back as a second tag.
 */
function normalizeTag(raw: string): string {
  return raw.trim()
}

export function TagEditor({
  tags,
  onChange,
  suggestions = [],
  placeholder = 'add a tag',
  className,
  label = 'Tags',
}: TagEditorProps) {
  const [draft, setDraft] = useState('')
  const listId = useId()

  function commit(raw: string) {
    const tag = normalizeTag(raw)
    setDraft('')
    // Case-insensitively, the way the backend de-duplicates: `Endgame` twice is one tag.
    if (!tag || tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return
    onChange([...tags, tag])
  }

  const taken = new Set(tags.map((tag) => tag.toLowerCase()))
  const offered = suggestions.filter((tag) => !taken.has(tag.toLowerCase()))

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-sm border border-edge bg-elevated px-1.5 py-px text-[0.625rem] text-soft"
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove the tag ${tag}`}
            onClick={() => onChange(tags.filter((one) => one !== tag))}
            className="text-faint transition-colors hover:text-blunder"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        list={offered.length ? listId : undefined}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => {
          const value = event.target.value
          // A comma is how a list is typed, and picking from the datalist fires a change
          // with the whole tag — both end the tag rather than leaving it in the box.
          if (value.endsWith(',')) commit(value.slice(0, -1))
          else setDraft(value)
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(draft)
            return
          }
          if (event.key === 'Backspace' && draft === '' && tags.length) {
            event.preventDefault()
            onChange(tags.slice(0, -1))
          }
        }}
        className="min-w-[6rem] flex-1 bg-transparent text-[0.6875rem] text-ink outline-none placeholder:text-faint"
      />
      {offered.length ? (
        <datalist id={listId}>
          {offered.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      ) : null}
    </div>
  )
}
