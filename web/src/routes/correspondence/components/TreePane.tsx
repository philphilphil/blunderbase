/**
 * The tree: the game's moves as the spine, everything that was considered nested under it.
 *
 * This is the middle column and the widest, because it is the thing the mode is for. A node
 * prints its move, its own evaluation, the minimax backed up from underneath when the two
 * differ (with the arrow that says which way), a depth chip, and a `≠` when two engines
 * disagree on the position. Marks are glyphs beside the move — `!`, `!?`, `?!`, `?`, `✕` —
 * the owner's word against the engine's, and the one the PGN exports as a NAG.
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
 * The context menu carries the whole verb set the design names. The verbs that need an
 * engine — search, task, expand — are drawn disabled with a note saying which step brings
 * them, rather than left out: a menu that grows new items later teaches the reader twice.
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
import { isActive, isLive, isWarm, weakNodes } from '../searches'
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
  /** A finished game's tree is read-only: every verb that writes is gone. */
  readOnly?: boolean
}

/** `12.` before a White move, `12…` before a Black one. */
function moveNumber(node: CorrespondenceTreeNode): string {
  const number = node.move_number ?? Math.floor((node.ply - 1) / 2) + 1
  return node.frame === 'white' ? `${number}.` : `${number}…`
}

function Chip({
  node,
  selected,
  weak,
  onSelect,
  onMenu,
}: {
  node: CorrespondenceTreeNode
  selected: boolean
  /** Far enough behind its best sibling to have left the decision — see `searches.ts`. */
  weak: boolean
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
  // Leela's depth means little and its node count means a lot, so a node whose verdict
  // came with one prints both — `docs/correspondence.md`, decision 5.
  const nodeCount = node.own?.nodes ?? null
  const mark = node.mark ?? null

  return (
    <span
      role="button"
      tabIndex={-1}
      data-testid={`tree-node-${node.id}`}
      data-selected={selected ? 'true' : undefined}
      onClick={onSelect}
      onContextMenu={onMenu}
      className={cn(
        'inline-flex cursor-pointer items-baseline gap-1 rounded-sm px-1 py-px align-baseline whitespace-nowrap hover:bg-raised',
        selected && 'bg-selected outline outline-accent-teal',
        (mark === 'excluded' || weak) && 'opacity-60',
      )}
    >
      <span className={cn('text-ink', node.played && 'font-semibold')}>
        {notate(node.san ?? node.uci ?? '')}
      </span>
      {mark ? (
        <span className={cn('-ml-0.5', MARK_CLASS[mark])} aria-hidden>
          {MARK_GLYPHS[mark]}
        </span>
      ) : null}
      {node.own ? (
        <span className="text-[0.6875rem] text-body">{formatScore(node.own)}</span>
      ) : null}
      {node.backed && direction !== null && direction !== 'same' ? (
        <span
          className={cn('text-[0.625rem]', direction === 'down' ? 'text-mistake' : 'text-good')}
          title={t`The minimax under this move disagrees with the engine's own number here`}
        >
          {direction === 'down' ? '▼' : '▲'} {formatScore(node.backed)}
        </span>
      ) : null}
      {depth !== null ? (
        <span className="rounded-sm border border-edge px-1 text-[0.5625rem] leading-[0.875rem] text-dim">
          d<span className="text-body">{depth}</span>
        </span>
      ) : null}
      {nodeCount ? (
        <span className="rounded-sm border border-edge px-1 text-[0.5625rem] leading-[0.875rem] text-dim">
          <span className="text-body">{formatNodes(nodeCount)}</span>
        </span>
      ) : null}
      {node.disagree ? (
        <span className="text-[0.625rem] text-mistake" title={t`Two engines disagree here`}>
          ≠
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
      {queued ? (
        <span className="text-[0.625rem] text-accent-teal" title={t`waiting for a slot`}>
          ◌
        </span>
      ) : null}
    </span>
  )
}

function Comment({ text }: { text: string }) {
  return (
    <div className="my-0.5 ml-2 border-l-2 border-edge py-px pl-2 font-sans text-[0.6875rem] leading-[1.45] text-soft">
      {text}
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
  selectedId,
  weak,
  onSelect,
  onMenu,
  leftBehind,
}: {
  start: CorrespondenceTreeNode
  selectedId: number | null
  weak: Set<number>
  onSelect: (id: number) => void
  onMenu: (node: CorrespondenceTreeNode, event: MouseEvent) => void
  leftBehind: boolean
}) {
  const parts: ReactNode[] = []
  let node: CorrespondenceTreeNode | undefined = start
  // True whenever the next chip begins a run — the first move, or the first after an
  // interruption — which is where a Black move has to print its number too.
  let opening = true

  while (node) {
    const current = node
    if (current.uci) {
      if (opening || current.frame === 'white') {
        parts.push(
          <span key={`n${current.id}`} className="mr-0.5 text-faint">
            {moveNumber(current)}
          </span>,
        )
      }
      parts.push(
        <Chip
          key={`c${current.id}`}
          node={current}
          selected={current.id === selectedId}
          weak={weak.has(current.id)}
          onSelect={() => onSelect(current.id)}
          onMenu={(event) => onMenu(current, event)}
        />,
      )
      parts.push(<span key={`s${current.id}`}> </span>)
      opening = false
    }

    if (current.comment) {
      parts.push(<Comment key={`m${current.id}`} text={current.comment} />)
      opening = true
    }

    const children = sortSiblings(current.children)
    for (const alternative of children.slice(1)) {
      parts.push(
        <div
          key={`v${alternative.id}`}
          data-weak={weak.has(alternative.id) ? 'true' : undefined}
          className={cn(
            'my-0.5 border-l border-hairline pl-3',
            (leftBehind || isLeftBehind(current, alternative)) && 'opacity-55',
            alternative.mark === 'excluded' && 'opacity-55',
            weak.has(alternative.id) && 'opacity-55',
          )}
        >
          <Line
            start={alternative}
            selectedId={selectedId}
            weak={weak}
            onSelect={onSelect}
            onMenu={onMenu}
            leftBehind={leftBehind || isLeftBehind(current, alternative)}
          />
        </div>,
      )
      opening = true
    }

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
  readOnly = false,
}: TreePaneProps) {
  const { i18n, t } = useLingui()
  const [menu, setMenu] = useState<TreeMenu | null>(null)
  const host = useRef<HTMLDivElement>(null)
  // One walk of the payload rather than one per node: which moves have fallen far enough
  // behind their best sibling to have stopped being part of the decision.
  const weak = useMemo(() => weakNodes(tree), [tree])

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
    <div ref={host} className="relative min-h-0 flex-1 overflow-auto px-3 py-2">
      <div className="font-mono text-[0.75rem] leading-[1.5]">
        <Line
          start={tree}
          selectedId={selectedId}
          weak={weak}
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
          <MenuItem disabled title={t`Tasks arrive in a later step`}>
            <Trans>Queue task</Trans>
          </MenuItem>
          <MenuItem disabled title={t`Expansion arrives in a later step`}>
            <Trans>Expand</Trans>
          </MenuItem>
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
