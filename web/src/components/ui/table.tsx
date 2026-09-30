import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * The dense library table from design 2b: a `text-meta` uppercase head, hairline rows, the
 * one hover (`--bb-raised`) and the selected row as the blue fill plus a 2px inset accent
 * bar (`shadow-row-bar`), which does not change under the pointer. The head is `dim` rather
 * than `faint` because a column name is read, not decoration; a head you can sort by is a
 * `SortableHead`. Lists that are not a `<table>` take the same states from `ui/row.ts`.
 */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn('w-full caption-bottom border-collapse text-data', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b [&_tr]:border-hairline', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('', className)} {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t border-hairline text-dim', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-hairline transition-colors hover:bg-raised focus-visible:outline-offset-[-0.125rem] data-[state=selected]:bg-selected data-[state=selected]:shadow-row-bar data-[state=selected]:hover:bg-selected',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-7 px-2.5 text-left align-middle text-meta font-normal tracking-[.06em] text-dim uppercase',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A column head you can sort by. It stays a column head (the same caps, the same size), and
 * the whole cell is its button: `soft` rather than `dim` because it is a control, lifting
 * to `raised` on hover with a faint ⇅ that says "sortable"; the sorted column is `ink` with
 * an arrow for its direction. `aria-sort` on the cell tells a screen reader which it is.
 * The ring is drawn inside the cell, since a table clips its head.
 */
function SortableHead({
  sorted,
  onSort,
  className,
  buttonClassName,
  children,
  ...props
}: Omit<React.ComponentProps<'th'>, 'onClick'> & {
  sorted: 'asc' | 'desc' | false
  onSort: () => void
  /** Classes on the inner button (alignment, e.g. `justify-end` for a figure column). */
  buttonClassName?: string
}) {
  return (
    <th
      data-slot="table-head"
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
      className={cn('h-7 p-0 text-left align-middle', className)}
      {...props}
    >
      <SortButton sorted={sorted} onSort={onSort} className={buttonClassName}>
        {children}
      </SortButton>
    </th>
  )
}

/**
 * `SortableHead`'s button on its own, for a list drawn as a div grid (`role="table"`), where
 * a `<th>` would be invalid nesting. The cell that holds it carries `aria-sort` itself.
 * Over a right-aligned figure column (`end`) the arrow goes in front of the word, so the
 * word stays flush with the figures under it.
 */
function SortButton({
  sorted,
  onSort,
  end = false,
  className,
  children,
}: {
  sorted: 'asc' | 'desc' | false
  onSort: () => void
  end?: boolean
  className?: string
  children: React.ReactNode
}) {
  const Arrow = sorted === 'asc' ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      onClick={onSort}
      className={cn(
        'group/sort inline-flex h-full w-full items-center gap-1 px-2.5 text-meta font-normal tracking-[.06em] uppercase transition-colors hover:bg-raised hover:text-ink focus-visible:outline-offset-[-0.125rem]',
        sorted ? 'text-ink' : 'text-soft',
        end && 'flex-row-reverse',
        className,
      )}
    >
      {children}
      {sorted ? (
        <Arrow aria-hidden className="size-2.5 flex-none" />
      ) : (
        <ChevronsUpDown
          aria-hidden
          className="size-2.5 flex-none text-faint opacity-0 group-hover/sort:opacity-100"
        />
      )}
    </button>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('h-8 px-2.5 align-middle whitespace-nowrap text-body', className)}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption data-slot="table-caption" className={cn('mt-3 text-label text-dim', className)} {...props} />
  )
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  SortableHead,
  SortButton,
}
