/**
 * The tree: the game's moves as the spine, everything that was considered nested under it.
 *
 * This is the middle column and the widest, because it is the thing the mode is for. It is
 * a grid, not flowing notation: **one row per ply**, with the same columns on every row —
 * move, own evaluation, the minimax backed up from underneath when the two differ (with the
 * arrow that says which way), depth, nodes, and the state glyphs — so the numbers line up
 * down the whole tree and a variation is read by comparing a column, not by parsing a
 * paragraph. That is how IDeA's tree reads, and it is what a tree of evaluated positions
 * is for; flowing PGN text was tried first and stopped being legible the moment every move
 * carried four numbers. A variation steps its rows in by one level and carries a rule down
 * its left; the indentation lives inside the move column so the other columns never move.
 * Marks are glyphs beside the move — `!`, `!?`, `?!`, `?`, `✕` — the owner's word against
 * the engine's, and the one the PGN exports as a NAG.
 *
 * Two kinds of quiet. A variation that hangs off a position the game has already left is
 * greyed: it was considered before the move was made and is kept in case of a
 * transposition. An **excluded** move is faded wherever it is: it is a move ruled out, and
 * it must not read as a candidate.
 *
 * The rendering is one recursion over the payload and not a flattening pass, because the
 * shape on screen *is* the shape of the tree: a run of moves, and under each of them the
 * alternatives to the move that follows it. `tree.ts` owns every question about order, so
 * the pane and the candidates table cannot disagree about which move is first.
 *
 * Three marks say what is *happening* to a node, and they are three different claims: a
 * spinner while an engine is on it, a queue mark while a task waits its turn — carrying
 * `2 of 7` when what is waiting is an expansion under the move rather than a look at the
 * move itself — and a stale mark when the number shown was reached too shallow or by an
 * engine version that is gone. The stale one is drawn from `node.stale`, which the server
 * computes: it is a comparison against a setting and against what is installed now, and a
 * client working it out for itself would be a second opinion about it.
 *
 * The context menu carries the whole verb set the design names. A verb is disabled with the
 * reason in its title rather than left out — an excluded move is never given engine time,
 * and a menu that hid the item would leave the reader wondering where it went.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import { Pin } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'

import type { CorrespondenceMark, CorrespondenceTreeNode } from '@/lib/api/types'
import { formatNodes, formatScore } from '@/lib/chess/evaluation'
import { useNotation } from '@/lib/chess/notationPrefs'
import { cn } from '@/lib/utils'

import {
  MARK_CLASS,
  MARK_GLYPHS,
  MARK_LABELS,
} from '../format'
import { isActive, isLive, isWarm, taskCounts, weakNodes, type TaskProgress } from '../searches'
import { backedDirection, isLeftBehind, sortSiblings } from '../tree'

export interface TreeMenu {
  nodeId: number
  x: number
  y: number
}

export interface TreePaneProps {
  tree: CorrespondenceTreeNode | null
  selectedId: number | null
  onSelect: (id: number) => void
  onMark: (id: number, mark: CorrespondenceMark | null) => void
  onComment: (node: CorrespondenceTreeNode) => void
  onPromote: (id: number) => void
  onDelete: (id: number) => void
  /** Open the search dialog on this node — the menu's first verb. */
  onSearch?: (node: CorrespondenceTreeNode) => void
  /** One bounded look at this position, through the analysis queue. */
  onQueueTask?: (node: CorrespondenceTreeNode) => void
  /** Open the expand dialog on this node: width, stages, and whether to queue tasks. */
  onExpand?: (node: CorrespondenceTreeNode) => void
  /** A task on every stale position from here down. */
  onRefresh?: (node: CorrespondenceTreeNode) => void
  /** Take this node's waiting task back out of the queue. */
  onCancelTask?: (searchId: number) => void
  /** A finished game's tree is read-only: every verb that writes is gone. */
  readOnly?: boolean
}

/** `12.` before a White move, `12…` before a Black one. */
function moveNumber(node: CorrespondenceTreeNode): string {
  const number = node.move_number ?? Math.floor((node.ply - 1) / 2) + 1
  return node.frame === 'white' ? `${number}.` : `${number}…`
}

/**
 * One column template for every row and for the heading, so the numbers line up down the
 * whole tree whatever a variation's depth: move (with the indentation inside it), own
 * eval, backed eval, depth, nodes, and the state glyphs.
 */
const COLUMNS = 'grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_2.5rem_3.5rem_4.5rem]'

/** How far a variation's rows step in per level of nesting. */
function indent(level: number): string {
  return `${level * 0.875}rem`
}

function Row({
  node,
  level,
  selected,
  weak,
  behind,
  progress,
  onSelect,
  onMenu,
}: {
  node: CorrespondenceTreeNode
  /** How many variations deep this row sits; the spine is 0. */
  level: number
  selected: boolean
  /** Far enough behind its best sibling to have left the decision — see `searches.ts`. */
  weak: boolean
  /** Hangs off a position the game has already left. */
  behind: boolean
  /** How much of the work under this node is still outstanding — the `2 of 7`. */
  progress?: TaskProgress
  onSelect: () => void
  onMenu: (event: MouseEvent) => void
}) {
  const { t } = useLingui()
  const notate = useNotation()
  const direction = backedDirection(node)
  const depth = node.own?.depth ?? null
  const searches = node.searches ?? []
  const searching = searches.some(isLive)
  const parked = searches.some(isWarm)
  const queued = searches.some((search) => search.status === 'queued')
  // A task is drawn from the node's own `task` rather than from the searches under it: the
  // server has already decided which of them the mark is about, and the two must not
  // disagree about whether a position is being worked on.
  const task = node.task ?? null
  const outstanding = progress && progress.left > 0 ? progress : null
  // Leela's depth means little and its node count means a lot, so a node whose verdict
  // came with one prints both — `docs/correspondence.md`, decision 5.
  const nodeCount = node.own?.nodes ?? null
  const mark = node.mark ?? null

  return (
    <div
      role="button"
      tabIndex={-1}
      data-testid={`tree-node-${node.id}`}
      data-selected={selected ? 'true' : undefined}
      onClick={onSelect}
      onContextMenu={onMenu}
      className={cn(
        COLUMNS,
        'grid cursor-pointer items-baseline gap-x-2 rounded-sm py-px pr-1 whitespace-nowrap hover:bg-raised',
        selected && 'bg-selected outline outline-accent-teal',
        (mark === 'excluded' || weak) && 'opacity-60',
        behind && 'opacity-55',
      )}
    >
      <span className="flex min-w-0 items-baseline gap-1" style={{ paddingLeft: indent(level) }}>
        <span className={cn(level > 0 && 'border-l border-hairline pl-2', 'flex items-baseline gap-1')}>
          <span className="text-faint">{moveNumber(node)}</span>
          <span className={cn('text-ink', node.played && 'font-semibold')}>
            {notate(node.san ?? node.uci ?? '')}
          </span>
          {mark ? (
            <span className={cn('-ml-0.5', MARK_CLASS[mark])} aria-hidden>
              {MARK_GLYPHS[mark]}
            </span>
          ) : null}
        </span>
      </span>
      <span className="text-right text-[0.6875rem] text-body tabular-nums">
        {node.own ? formatScore(node.own) : ''}
      </span>
      <span
        className={cn(
          'text-right text-[0.625rem] tabular-nums',
          direction === 'down' ? 'text-mistake' : direction === 'up' ? 'text-good' : 'text-dim',
        )}
        title={
          node.backed && direction !== null && direction !== 'same'
            ? t`The minimax under this move disagrees with the engine's own number here`
            : undefined
        }
      >
        {node.backed && direction !== null && direction !== 'same'
          ? `${direction === 'down' ? '▼' : '▲'} ${formatScore(node.backed)}`
          : ''}
      </span>
      <span className="text-right text-[0.625rem] text-dim tabular-nums">
        {depth !== null ? (
          <>
            d<span className="text-body">{depth}</span>
          </>
        ) : (
          ''
        )}
      </span>
      <span className="text-right text-[0.625rem] text-body tabular-nums">
        {nodeCount ? formatNodes(nodeCount) : ''}
      </span>
      <span className="flex items-baseline gap-1">
      {node.disagree ? (
        <span className="text-[0.625rem] text-mistake" title={t`Two engines disagree here`}>
          ≠
        </span>
      ) : null}
      {node.stale ? (
        <span
          data-testid={`tree-stale-${node.id}`}
          className="text-[0.625rem] text-inaccuracy"
          title={t`This number is stale: it was reached below the stale depth, or by a version of the engine you no longer have. Refresh subtree asks again.`}
        >
          ⟳
        </span>
      ) : null}
      {node.pinned_engine_id ? (
        <span title={t`One engine's verdict is pinned here`}>
          <Pin className="size-2.5 text-accent-teal" aria-label={t`one engine's verdict is pinned here`} />
        </span>
      ) : null}
      {searching ? (
        <span
          aria-label={t`searching`}
          className="inline-block size-2 animate-spin rounded-full border-[0.09375rem] border-good border-r-transparent align-[-0.0625rem]"
        />
      ) : null}
      {parked ? (
        <span
          aria-label={t`parked`}
          className="inline-block size-2 rounded-full border-[0.09375rem] border-mistake align-[-0.0625rem]"
          title={t`An engine is parked here, warm — resuming costs seconds`}
        />
      ) : null}
      {queued || outstanding ? (
        <span
          data-testid={`tree-queued-${node.id}`}
          className="text-[0.625rem] text-accent-teal"
          title={
            task?.status === 'queued'
              ? t`A task is waiting in the analysis queue`
              : queued
                ? t`waiting for a slot`
                : t`Tasks are still out on the positions under this move`
          }
        >
          ◌
          {outstanding ? (
            <span className="ml-0.5 text-[0.5625rem] text-dim">
              {t`${outstanding.left} of ${outstanding.total}`}
            </span>
          ) : null}
        </span>
      ) : null}
      </span>
    </div>
  )
}

function Comment({ text, level }: { text: string; level: number }) {
  return (
    <div
      className="my-0.5 border-l-2 border-edge py-px pl-2 font-sans text-[0.6875rem] leading-[1.45] text-soft"
      style={{ marginLeft: `calc(${indent(level)} + 1.75rem)` }}
    >
      {text}
    </div>
  )
}

/** The column heads, sticky over the rows so a long tree still says what a column is. */
function Heading() {
  return (
    <div
      className={cn(
        COLUMNS,
        'sticky top-0 z-10 grid gap-x-2 border-b border-hairline bg-surface py-1 pr-1 font-sans text-[0.625rem] text-dim',
      )}
    >
      <span>
        <Trans>Move</Trans>
      </span>
      <span className="text-right">
        <Trans>Own</Trans>
      </span>
      <span className="text-right">
        <Trans>Backed</Trans>
      </span>
      <span className="text-right">
        <Trans>Depth</Trans>
      </span>
      <span className="text-right">
        <Trans>Nodes</Trans>
      </span>
      <span />
    </div>
  )
}

/**
 * One run of moves and, under each of them, the alternatives to the move that follows.
 *
 * The chain is followed through the first child at every step (`mainlineFrom` in spirit,
 * expanded here so the alternatives can be emitted in place), which is exactly how a
 * printed game reads: a line, interrupted where somebody considered something else.
 */
function Line({
  start,
  level,
  selectedId,
  weak,
  progress,
  onSelect,
  onMenu,
  leftBehind,
}: {
  start: CorrespondenceTreeNode
  /** How deep in variations this line sits; the spine is 0. */
  level: number
  selectedId: number | null
  weak: Set<number>
  progress: Map<number, TaskProgress>
  onSelect: (id: number) => void
  onMenu: (node: CorrespondenceTreeNode, event: MouseEvent) => void
  leftBehind: boolean
}) {
  const parts: ReactNode[] = []
  let node: CorrespondenceTreeNode | undefined = start
  // The alternatives to the move just printed, and the position they all answer. Printed
  // *after* the move, the way every notation does it — `2. Nf3 d6 (2… g6) (2… Nc6) 3. d4`
  // — so the line reads on and the variations hang off the move they replace. The start of
  // a line has none here: its own siblings are the alternatives the parent Line prints.
  let alternatives: CorrespondenceTreeNode[] = []
  let parent: CorrespondenceTreeNode | null = null

  while (node) {
    const current = node
    if (current.uci) {
      parts.push(
        <Row
          key={`c${current.id}`}
          node={current}
          level={level}
          selected={current.id === selectedId}
          weak={weak.has(current.id)}
          behind={leftBehind}
          progress={progress.get(current.id)}
          onSelect={() => onSelect(current.id)}
          onMenu={(event) => onMenu(current, event)}
        />,
      )
    }

    if (current.comment) {
      parts.push(<Comment key={`m${current.id}`} text={current.comment} level={level} />)
    }

    for (const alternative of alternatives) {
      const behind = leftBehind || isLeftBehind(parent, alternative)
      parts.push(
        <div key={`v${alternative.id}`} data-weak={weak.has(alternative.id) ? 'true' : undefined}>
          <Line
            start={alternative}
            level={level + 1}
            selectedId={selectedId}
            weak={weak}
            progress={progress}
            onSelect={onSelect}
            onMenu={onMenu}
            leftBehind={behind}
          />
        </div>,
      )
    }

    const children = sortSiblings(current.children)
    parent = current
    alternatives = children.slice(1)
    node = children[0]
  }

  return <>{parts}</>
}

function MenuItem({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'w-full rounded-sm px-2 py-1 text-left text-[0.75rem] transition-colors',
        disabled ? 'cursor-default text-faint' : 'text-body hover:bg-selected hover:text-ink',
        danger && !disabled && 'text-blunder hover:text-blunder',
      )}
    >
      {children}
    </button>
  )
}

export function TreePane({
  tree,
  selectedId,
  onSelect,
  onMark,
  onComment,
  onPromote,
  onDelete,
  onSearch,
  onQueueTask,
  onExpand,
  onRefresh,
  onCancelTask,
  readOnly = false,
}: TreePaneProps) {
  const { i18n, t } = useLingui()
  const [menu, setMenu] = useState<TreeMenu | null>(null)
  const host = useRef<HTMLDivElement>(null)
  // One walk of the payload rather than one per node: which moves have fallen far enough
  // behind their best sibling to have stopped being part of the decision.
  const weak = useMemo(() => weakNodes(tree), [tree])
  // The same, for how many tasks are still out under each node — one post-order walk for
  // the whole tree, because every chip asks.
  const progress = useMemo(() => taskCounts(tree), [tree])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', close)
    }
  }, [menu])

  if (!tree) {
    return (
      <div className="p-4 text-[0.75rem] text-dim">
        <Trans>This game has no tree yet.</Trans>
      </div>
    )
  }

  const menuNode = menu ? findNode(tree, menu.nodeId) : null

  return (
    <div ref={host} className="relative min-h-0 flex-1 overflow-auto px-3 pb-2">
      <div className="font-mono text-[0.75rem] leading-[1.5]">
        <Heading />
        <Line
          start={tree}
          level={0}
          selectedId={selectedId}
          weak={weak}
          progress={progress}
          onSelect={onSelect}
          onMenu={(node, event) => {
            if (readOnly) return
            event.preventDefault()
            const box = host.current?.getBoundingClientRect()
            setMenu({
              nodeId: node.id,
              x: event.clientX - (box?.left ?? 0),
              y: event.clientY - (box?.top ?? 0) + (host.current?.scrollTop ?? 0),
            })
            onSelect(node.id)
          }}
          leftBehind={false}
        />
      </div>

      {menu && menuNode ? (
        <div
          role="menu"
          data-testid="tree-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
          className="absolute z-30 w-56 rounded-md border border-edge-strong bg-panel p-1 shadow-[0_0.375rem_1.125rem_var(--bb-shadow)]"
        >
          <MenuItem
            disabled={!onSearch}
            onClick={() => {
              onSearch?.(menuNode)
              setMenu(null)
            }}
          >
            <Trans>Search with…</Trans>
          </MenuItem>
          <MenuItem
            disabled={!onQueueTask || menuNode.mark === 'excluded' || Boolean(menuNode.task)}
            title={
              menuNode.mark === 'excluded'
                ? t`An excluded move is never given engine time`
                : menuNode.task
                  ? t`A task is already on this position`
                  : t`One bounded look at this position, through the analysis queue`
            }
            onClick={() => {
              onQueueTask?.(menuNode)
              setMenu(null)
            }}
          >
            <Trans>Queue task</Trans>
          </MenuItem>
          <MenuItem
            disabled={!onExpand || menuNode.mark === 'excluded'}
            title={
              menuNode.mark === 'excluded'
                ? t`An excluded move is never expanded`
                : t`Make the best moves here into children and put a task under each`
            }
            onClick={() => {
              onExpand?.(menuNode)
              setMenu(null)
            }}
          >
            <Trans>Expand…</Trans>
          </MenuItem>
          <MenuItem
            disabled={!onRefresh}
            title={t`Queue a task on every stale position from here down`}
            onClick={() => {
              onRefresh?.(menuNode)
              setMenu(null)
            }}
          >
            <Trans>Refresh subtree</Trans>
          </MenuItem>
          {menuNode.task && menuNode.task.status === 'queued' ? (
            <MenuItem
              disabled={!onCancelTask}
              title={t`Take this waiting task back out of the queue`}
              onClick={() => {
                onCancelTask?.(menuNode.task?.search_id as number)
                setMenu(null)
              }}
            >
              <Trans>Cancel task</Trans>
            </MenuItem>
          ) : null}
          <hr className="my-1 border-0 border-t border-line" />
          <div className="flex items-center gap-1 px-2 py-1">
            <span className="text-[0.625rem] text-dim">
              <Trans>Mark</Trans>
            </span>
            <div className="flex flex-1 justify-end gap-0.5">
              {(Object.keys(MARK_GLYPHS) as CorrespondenceMark[]).map((mark) => (
                <button
                  key={mark}
                  type="button"
                  aria-pressed={menuNode.mark === mark}
                  // The glyph is the whole button, so the name it would have read has to be
                  // said some other way or the control has none at all.
                  aria-label={i18n._(MARK_LABELS[mark])}
                  title={i18n._(MARK_LABELS[mark])}
                  onClick={() => {
                    onMark(menuNode.id, menuNode.mark === mark ? null : mark)
                    setMenu(null)
                  }}
                  className={cn(
                    'min-w-6 rounded-sm border px-1 py-px font-mono text-[0.6875rem] transition-colors',
                    menuNode.mark === mark
                      ? 'border-accent-teal/40 bg-selected'
                      : 'border-edge hover:bg-raised',
                    MARK_CLASS[mark],
                  )}
                >
                  {MARK_GLYPHS[mark]}
                </button>
              ))}
            </div>
          </div>
          <MenuItem
            onClick={() => {
              onComment(menuNode)
              setMenu(null)
            }}
          >
            <Trans>Comment…</Trans>
          </MenuItem>
          <MenuItem
            disabled={menuNode.parent_id === null}
            onClick={() => {
              onPromote(menuNode.id)
              setMenu(null)
            }}
          >
            <Trans>Promote to first</Trans>
          </MenuItem>
          <hr className="my-1 border-0 border-t border-line" />
          <MenuItem
            danger
            disabled={
              menuNode.parent_id === null ||
              menuNode.played ||
              (menuNode.searches ?? []).some(isActive)
            }
            title={
              menuNode.played
                ? t`A move the game played cannot be deleted`
                : (menuNode.searches ?? []).some(isActive)
                  ? t`An engine is still on this line`
                  : undefined
            }
            onClick={() => {
              onDelete(menuNode.id)
              setMenu(null)
            }}
          >
            <Trans>Delete subtree</Trans>
          </MenuItem>
        </div>
      ) : null}
    </div>
  )
}

/** One node out of the payload by id — the menu holds an id, not a node. */
export function findNode(
  root: CorrespondenceTreeNode,
  id: number,
): CorrespondenceTreeNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}
