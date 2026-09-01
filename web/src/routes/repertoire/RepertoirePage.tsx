/**
 * The two opening repertoires — White's and Black's — and the board that edits them.
 *
 * There is no separate "edit" mode and no "add move" button, because the gesture that adds
 * a move to a repertoire and the gesture that walks one are the same gesture: you play the
 * move. Dragging a piece extends the line; if that move is not yet a child of the node the
 * line stands on, the page posts the whole path and the backend creates whatever is
 * missing. So the page *is* the editor, and the only thing the owner has to decide is what
 * to play — which is the only decision a repertoire is made of.
 *
 * The rest follows the explorer's idiom deliberately, because the two screens are walked
 * the same way and nobody should have to learn a second set of habits:
 *
 * - The line rides in the URL (`?line=e2e4,e7e5`, `?color=white`), so any position in
 *   either tree is a link and the back button walks backwards for free. `?color` is a lens
 *   (`replace: true`) — which repertoire you are looking at is not a place you went — and
 *   switching it drops the line, because a path through one tree is not a path through the
 *   other.
 * - The board is replayed client-side from the UCI list (`routes/explorer/line.ts`); the
 *   server is asked for the tree and nothing else.
 * - Board on the left with the breadcrumb, transport and the selected move's editor under
 *   it; the tree on the right, as movetext.
 *
 * Two things are on the board rather than in the pane. The continuations from the current
 * position are drawn as arrows — the main move in the strong accent brush, the sidelines
 * pale — so the repertoire is legible while walking it without reading a table. And the
 * comment editor sits under the board with the position it is about, the way
 * `PositionNotes` does on the explorer, saving itself on blur: a comment is written while
 * looking at the position, and a Save button is a thing to forget to press.
 *
 * The per-node actions (promote, delete) are under the board and act on the *selected*
 * node rather than being a pair of buttons on every row. A tree row is one target that
 * jumps the line, and a destructive control inside a row that is itself a button is how
 * somebody deletes a branch they meant to visit. Deleting takes two clicks on the same
 * button rather than a `window.confirm`, which the rest of the app does not use either.
 */
import type { Api } from '@lichess-org/chessground/api'
import { MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Board, type BoardArrow } from '@/components/board/Board'
import { SetPageChrome } from '@/components/shell/PageChrome'
import {
  useAddRepertoireLine,
  useDeleteRepertoireMove,
  useRepertoire,
  useUpdateRepertoireMove,
} from '@/lib/api/queries'
import type { Color, RepertoireNode } from '@/lib/api/types'
import { cn } from '@/lib/utils'
import { LineBreadcrumb } from '@/routes/explorer/components/LineBreadcrumb'
import {
  buildLine,
  formatLineParam,
  parseLineParam,
  plyLabel,
  truncateTo,
  withMove,
} from '@/routes/explorer/line'
import { isTyping } from '@/routes/game/useBoardKeys'

import {
  childrenAt,
  countNodes,
  flattenTree,
  inRepertoire,
  nodeAt,
  type RepertoireRow,
} from './tree'

/** How long the `saved` mark stays up — the same two seconds `PositionNotes` uses. */
const FLASH_MS = 2000

/** One indent step per sideline depth, in rem. */
const INDENT_REM = 0.875

export function RepertoirePage() {
  const [params, setParams] = useSearchParams()

  const color: Color = params.get('color') === 'black' ? 'black' : 'white'
  const ucis = useMemo(() => parseLineParam(params.get('line')), [params])
  const line = useMemo(() => buildLine(ucis), [ucis])

  const [flipped, setFlipped] = useState(false)
  // How many line writes are queued or in flight. `add.isPending` cannot answer that: the
  // mutation is dispatched to 'success' as soon as its `onSuccess` returns, which is one
  // whole tree refetch before the answer is on screen, and it is false again between two
  // chained writes.
  const [writes, setWrites] = useState(0)
  const boardApi = useRef<Api | null>(null)
  // The longest line visited, so "forward" walks back into what was just undone.
  const trail = useRef<string[]>(ucis)

  const tree = useRepertoire(color)
  const add = useAddRepertoireLine()
  const update = useUpdateRepertoireMove()
  const remove = useDeleteRepertoireMove()

  const roots = useMemo(() => tree.data?.moves ?? [], [tree.data])
  const current = useMemo(() => nodeAt(roots, ucis), [roots, ucis])
  const continuations = useMemo(() => childrenAt(roots, ucis), [roots, ucis])
  const rows = useMemo(() => flattenTree(roots), [roots])
  const total = useMemo(() => countNodes(roots), [roots])
  const onBook = useMemo(() => inRepertoire(roots, ucis), [roots, ucis])

  const setLine = useCallback(
    (next: readonly string[], { remember = true }: { remember?: boolean } = {}) => {
      if (remember) trail.current = [...next]
      const updated = new URLSearchParams(params)
      if (next.length === 0) updated.delete('line')
      else updated.set('line', formatLineParam(next))
      setParams(updated)
    },
    [params, setParams],
  )

  const setColor = useCallback(
    (next: Color) => {
      const updated = new URLSearchParams(params)
      updated.set('color', next)
      // The line belongs to the tree it was walked in. Carrying it across would leave the
      // two panes describing different trees — Black's moves on the right, a White line on
      // the left — and the off-book banner would then offer to write that White line into
      // the Black repertoire, which is the one click that would make it true.
      updated.delete('line')
      trail.current = []
      setParams(updated, { replace: true })
    },
    [params, setParams],
  )

  // chessground has no prop for the legal destinations — `Board` publishes its `Api` for
  // exactly this, and `configure` deep-merges, so what is written here survives the
  // wrapper's own `set()` calls.
  useEffect(() => {
    boardApi.current?.set({ movable: { free: false, showDests: true, dests: line.dests } })
  }, [line.dests])

  const back = useCallback(() => {
    if (line.steps.length === 0) return
    setLine(truncateTo(line, line.ply - 1), { remember: false })
  }, [line, setLine])

  const forward = useCallback(() => {
    const remembered = trail.current
    const walked = line.steps.map((step) => step.uci)
    const continues =
      remembered.length > walked.length &&
      walked.every((uci, index) => remembered[index] === uci)
    if (!continues) return
    setLine(remembered.slice(0, walked.length + 1), { remember: false })
  }, [line, setLine])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A modifier makes an arrow the browser's own command — ⌘← is history-back, and
      // walking the line as well would fight the history entry the router just wrote.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (isTyping(event.target)) return
      if (event.key === 'ArrowLeft') back()
      if (event.key === 'ArrowRight') forward()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [back, forward])

  /**
   * Store a line the repertoire does not have yet. The URL never waits for it, but the
   * writes wait for each other.
   *
   * Two moves played inside one round trip would otherwise post two lines whose shared
   * prefix does not exist yet — `1.e4` and `1.e4 e5`, both sent before the tree has come
   * back — and `add_line` is a find-or-create per node with nothing in the schema to stop
   * two of them, so both requests would create the `e4` node and the tree would grow two
   * `1.e4` rows that nothing can merge. Chaining them means the second walk finds what the
   * first wrote, which is also what makes the write idempotent the way it is meant to be.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const store = useCallback(
    (path: readonly string[]) => {
      if (path.length === 0) return
      setWrites((count) => count + 1)
      // A failed write must not stop the next one, and the failure is already on screen
      // through the mutation's own error — the catches are only so a rejection is handled.
      queue.current = queue.current
        .catch(() => {})
        .then(() => add.mutateAsync({ color, body: { ucis: [...path] } }))
        .finally(() => setWrites((count) => count - 1))
      queue.current.catch(() => {})
    },
    [add, color],
  )

  /**
   * A move played on the board. Extending the line is unconditional; writing it is what
   * depends on whether the repertoire already knows the move.
   */
  const played = useCallback(
    (orig: string, dest: string) => {
      const next = withMove(line, orig, dest)
      // Nothing legal was played, so put the piece back where the FEN says it is.
      if (!next) {
        boardApi.current?.set({ fen: line.fen })
        return
      }
      const uci = next[next.length - 1]
      const known = onBook && continuations.some((child) => child.uci === uci)
      setLine(next)
      if (!known) store(next)
    },
    [line, onBook, continuations, setLine, store],
  )

  const arrows = useMemo<BoardArrow[]>(
    () =>
      continuations.map((child, index) => ({
        from: child.uci.slice(0, 2),
        to: child.uci.slice(2, 4),
        // The main move in the strong accent brush, everything else pale: the point of the
        // overlay is which reply is *the* reply, and equal arrows would not say it.
        color: index === 0 ? 'accent' : 'paleAccent',
      })),
    [continuations],
  )

  const orientation = flipped ? (color === 'white' ? 'black' : 'white') : color
  const writeError = add.error ?? update.error ?? remove.error

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetPageChrome
        breadcrumb={[{ label: 'Openings', to: '/explorer' }, { label: 'Repertoire' }]}
      />

      {/*
        The same responsive shape as the explorer: two panes that scroll separately from
        `md` up, one column that scrolls as a whole below it — a fixed board over a short
        scroller is not a phone layout.
      */}
      <div className="flex min-h-0 flex-1 gap-[1.125rem] overflow-hidden px-5 py-[1.125rem] max-md:flex-col max-md:gap-3 max-md:overflow-y-auto max-md:px-3 max-md:py-3">
        <div className="flex w-[31.25rem] flex-none flex-col gap-3.5 max-md:w-full">
          <div className="flex flex-col gap-[0.4375rem]">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[0.9375rem] font-semibold text-ink">
                {color === 'white' ? 'White repertoire' : 'Black repertoire'}
              </h1>
              <div className="flex-1" />
              <ColorToggle color={color} onChange={setColor} />
            </div>
            <LineBreadcrumb
              steps={line.steps}
              onTruncate={(ply) => setLine(truncateTo(line, ply), { remember: false })}
            />
          </div>

          <Board
            fen={line.fen}
            orientation={orientation}
            lastMove={line.lastMove}
            turnColor={line.turn}
            arrows={arrows}
            viewOnly={false}
            onMove={played}
            className="w-[28.75rem] max-md:w-full"
            ref={boardApi}
          />

          <div className="flex items-center gap-2.5 max-md:flex-wrap">
            <div className="flex overflow-hidden rounded-md border border-edge bg-elevated">
              <button
                type="button"
                aria-label="Back one move"
                onClick={back}
                disabled={line.steps.length === 0}
                className="border-r border-edge px-2.5 py-1 text-xs text-soft transition-colors hover:bg-selected hover:text-ink disabled:text-faint-2 disabled:hover:bg-transparent"
              >
                ◀
              </button>
              <button
                type="button"
                aria-label="Forward one move"
                onClick={forward}
                className="px-2.5 py-1 text-xs text-soft transition-colors hover:bg-selected hover:text-ink"
              >
                ▶
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFlipped((was) => !was)}
              className="rounded-md border border-edge bg-elevated px-2.5 py-1 text-xs text-soft transition-colors hover:text-ink"
            >
              ⇅ Flip
            </button>
            {line.steps.length > 0 ? (
              <button
                type="button"
                onClick={() => setLine([])}
                className="rounded-md border border-edge bg-elevated px-2.5 py-1 text-xs text-soft transition-colors hover:text-ink"
              >
                Reset
              </button>
            ) : null}
            <div className="flex-1" />
            <span className="font-mono text-[0.6875rem] tabular text-dim">
              {line.turn} to move · ply {line.ply}
            </span>
          </div>

          {/*
            The one thing that is not a repertoire move: a line the owner walked to that
            the repertoire does not hold. It only appears on a deep link or after a failed
            write — playing a move stores it — so the banner offers the same write rather
            than explaining itself at length.

            It is shown only when the page actually knows the line is missing, which is a
            narrower thing than "the tree query is not pending": a read that failed knows
            nothing, and an empty `roots` while a write is queued or the tree is refetching
            is the answer to a question already being asked. Getting that wrong flashes the
            banner after every single move played, which is the one gesture this page is
            made of.
          */}
          {tree.isSuccess && !onBook && writes === 0 && !tree.isFetching ? (
            <div className="flex items-center gap-2.5 rounded-[0.5625rem] border border-mistake/28 bg-mistake/5 px-3 py-2.5">
              <p className="flex-1 text-[0.78125rem] leading-relaxed text-soft">
                This line is not in your {color} repertoire yet.
              </p>
              <button
                type="button"
                onClick={() => store(ucis)}
                className="flex-none rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
              >
                Add this line
              </button>
            </div>
          ) : null}

          <NodeEditor
            node={current}
            main={continuationIsMain(roots, ucis, current)}
            onComment={(comment) =>
              current ? update.mutateAsync({ id: current.id, body: { comment } }) : Promise.resolve()
            }
            onPromote={() =>
              current ? update.mutate({ id: current.id, body: { promote: true } }) : undefined
            }
            onDelete={() => {
              if (!current) return
              remove.mutate(current.id)
              // The one walk backwards that *does* forget the trail: everything past the
              // parent has just been deleted, and remembering it would let ▶ (or →) push
              // the line straight back onto the move that is gone, where the page would
              // offer to add it again — one keystroke after the owner deleted it.
              setLine(truncateTo(line, line.ply - 1))
            }}
          />

          {writeError ? (
            <p className="text-[0.6875rem] text-blunder">{writeError.message}</p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto max-md:flex-none max-md:overflow-visible">
          <div className="flex flex-none items-center gap-2.5">
            <span className="text-[0.75rem] font-semibold text-ink">
              Your {color} repertoire
            </span>
            <div className="flex-1" />
            <span className="font-mono text-[0.6875rem] tabular text-dim">
              {total} {total === 1 ? 'move' : 'moves'}
            </span>
          </div>

          {tree.isError ? (
            <div className="flex flex-col items-start gap-2.5 rounded-xl border border-blunder/28 bg-blunder/5 p-5">
              <span className="text-[0.75rem] font-semibold text-blunder">
                Could not read the repertoire
              </span>
              <p className="text-[0.78125rem] leading-relaxed text-soft">
                {tree.error?.message ?? 'The backend did not answer.'}
              </p>
              <button
                type="button"
                onClick={() => void tree.refetch()}
                className="rounded-md border border-edge-input px-2.5 py-1 text-[0.71875rem] text-soft hover:border-edge-hover hover:text-ink"
              >
                Try again
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-[0.5625rem] border border-dashed border-edge-strong bg-panel/60 px-5 py-8 text-center">
              <p className="text-[0.78125rem] leading-relaxed text-dim">
                {tree.isPending
                  ? 'Reading your repertoire…'
                  : `Nothing here yet. Play moves on the board to start your ${color} repertoire — every move you play is saved as you go.`}
              </p>
            </div>
          ) : (
            <MoveTree rows={rows} selected={current?.id ?? null} onJump={setLine} />
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Whether the selected node is the main move among its own siblings.
 *
 * Read off the sorted sibling list rather than off `rank === 0`, so "printed first" and
 * "called main" cannot disagree: the promote button must be hidden for exactly the move
 * the tree pane draws at the top of its group.
 */
function continuationIsMain(
  roots: readonly RepertoireNode[],
  ucis: readonly string[],
  node: RepertoireNode | null,
): boolean {
  if (!node) return false
  const siblings = childrenAt(roots, ucis.slice(0, -1))
  return siblings[0]?.id === node.id
}

/** Which repertoire is on screen. The explorer's segmented control, with two options. */
function ColorToggle({ color, onChange }: { color: Color; onChange: (next: Color) => void }) {
  const options: Color[] = ['white', 'black']
  return (
    <div className="flex overflow-hidden rounded-md border border-edge font-mono text-[0.6875rem]">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          aria-pressed={color === option}
          onClick={() => onChange(option)}
          className={cn(
            'px-2.5 py-1 transition-colors',
            index > 0 && 'border-l border-edge',
            color === option ? 'bg-selected text-ink' : 'text-dim hover:text-ink',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

/**
 * The selected move: its comment, and the two things that can be done to it.
 *
 * The comment is a plain textarea that writes on blur — see `PositionNotes` for why the
 * app prefers that to a Save button — with the two rules that keeps safe: text that did
 * not change writes nothing, and Escape abandons the edit and puts the stored text back.
 * Unlike a note, emptying the box *is* a valid edit and clears the comment: a comment is
 * one field on a move the owner is already looking at, not a document, and there is no
 * other way to take one off.
 */
function NodeEditor({
  node,
  main,
  onComment,
  onPromote,
  onDelete,
}: {
  node: RepertoireNode | null
  /** Whether it is already the main move, which is what hides `Promote`. */
  main: boolean
  onComment: (comment: string | null) => Promise<unknown>
  onPromote: () => void
  onDelete: () => void
}) {
  const [text, setText] = useState('')
  const [flash, setFlash] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const abandoned = useRef(false)

  const id = node?.id ?? null
  const stored = node?.comment ?? ''

  // The box follows the selection: walking the tree must never carry one move's text onto
  // another, and a refetch after a write is what puts the saved text back under the box.
  useEffect(() => {
    setText(stored)
    setConfirming(false)
  }, [id, stored])

  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(0), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  if (!node) {
    return (
      <div className="flex flex-none flex-col gap-[0.4375rem] rounded-[0.5625rem] border border-line bg-panel p-[0.8125rem]">
        <span className="text-[0.75rem] font-semibold text-ink">No move selected</span>
        <p className="text-[0.78125rem] leading-relaxed text-dim">
          Play a move on the board, or pick one from the tree, to comment on it.
        </p>
      </div>
    )
  }

  function commit() {
    if (abandoned.current) {
      abandoned.current = false
      return
    }
    if (text === stored) return
    // `null` is the contract's way of clearing a comment; the tree payload never carries
    // one back as null, so the box is bound to the empty string either way.
    // The failure is already on screen through the mutation's own error; the catch is only
    // so a rejected write is not also an unhandled rejection.
    void onComment(text === '' ? null : text)
      .then(() => setFlash(Date.now()))
      .catch(() => {})
  }

  return (
    <div className="flex flex-none flex-col gap-[0.4375rem] rounded-[0.5625rem] border border-line bg-panel p-[0.8125rem]">
      <div className="flex items-center gap-2">
        <span className="text-[0.75rem] font-semibold text-ink">
          <span className="font-mono">{node.san}</span> — your note on this move
        </span>
        {flash ? (
          <span role="status" className="text-[0.625rem] text-good">
            saved
          </span>
        ) : null}
      </div>

      <textarea
        value={text}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            abandoned.current = true
            setText(stored)
            event.currentTarget.blur()
          }
        }}
        placeholder="Why this move? It saves when you click away."
        aria-label={`Comment on ${node.san}`}
        className="w-full resize-none rounded-md border border-input bg-raised px-2.5 py-1.5 text-[0.78125rem] leading-[1.5] text-ink outline-none placeholder:text-faint focus-visible:border-accent-teal/50"
      />

      <div className="flex items-center gap-2">
        {main ? null : (
          <button
            type="button"
            onClick={onPromote}
            className="rounded-md border border-edge px-2 py-[0.1875rem] text-[0.6875rem] text-soft hover:border-edge-hover hover:text-ink"
          >
            Promote to main
          </button>
        )}
        <div className="flex-1" />
        {/*
          Two clicks on one button rather than a `window.confirm`: the app uses no native
          dialogs, and a branch is the one thing on this page whose loss cannot be undone
          by playing the move again — the comments under it go with it.
        */}
        <button
          type="button"
          onClick={() => {
            if (confirming) onDelete()
            else setConfirming(true)
          }}
          onBlur={() => setConfirming(false)}
          className={cn(
            'rounded-md border px-2 py-[0.1875rem] text-[0.6875rem] transition-colors',
            confirming
              ? 'border-blunder/45 bg-blunder/10 text-blunder'
              : 'border-edge text-soft hover:border-edge-hover hover:text-blunder',
          )}
        >
          {confirming ? 'Confirm — delete branch' : 'Delete branch'}
        </button>
      </div>
    </div>
  )
}

/**
 * The whole colour's tree as movetext: the main line straight down the page, sidelines
 * indented under the move they replace (`flattenTree` puts them in that order).
 *
 * One button per move and nothing else inside it, so a row has exactly one meaning —
 * jump the line here. A move that carries a comment says so with an icon rather than by
 * printing it: the text belongs under the board, beside the position it is about, and a
 * tree that prints its own annotations stops being scannable after the third one.
 */
function MoveTree({
  rows,
  selected,
  onJump,
}: {
  rows: readonly RepertoireRow[]
  selected: number | null
  onJump: (path: string[]) => void
}) {
  return (
    <div
      className="flex flex-col gap-px font-mono text-[0.78125rem]"
      role="tree"
      aria-label="Repertoire moves"
    >
      {rows.map((row) => {
        const active = row.node.id === selected
        return (
          <button
            key={row.node.id}
            type="button"
            role="treeitem"
            aria-selected={active}
            aria-level={row.depth + 1}
            onClick={() => onJump(row.path)}
            style={{ paddingLeft: `${0.5 + row.depth * INDENT_REM}rem` }}
            className={cn(
              'flex items-center gap-1.5 rounded-[0.3125rem] py-[0.1875rem] pr-2 text-left transition-colors',
              active
                ? 'bg-selected text-ink'
                : row.main
                  ? 'text-body hover:bg-elevated-2'
                  : 'text-dim hover:bg-elevated-2 hover:text-soft',
            )}
          >
            <span className={cn(row.depth > 0 && 'text-[0.71875rem]')}>
              {plyLabel(row.ply)}
              {row.node.san}
            </span>
            {row.node.comment ? (
              <MessageSquare
                role="img"
                aria-label="has a comment"
                className="size-2.5 flex-none text-accent-teal"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
