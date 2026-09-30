/**
 * `/correspondence/:id` — one game, and the tree behind it.
 *
 * This is its own view and not the game page with a pane swapped. The game page is built
 * around a finished line and one engine's verdict on it; this is built around a tree and
 * several engines thinking at once, and the tree is the thing in the middle.
 *
 * Three columns on a wide screen, as `docs/design/prototypes/correspondence-view.html`
 * draws them: the board at the selected node with the notes under it, the tree, and a
 * column of engines. The notes sit under the board rather than under the engines because
 * two engine panes stacked left them a strip, and the journal — what the opponent tends to
 * do, the plan — is what a player opens first when a game comes round after eight days.
 * There is no candidates table: it was the selected node's children, which the tree
 * already shows one level down, and the board draws them as arrows. Below `md` the four
 * panes are tabs, the way `MobileGameView` does it — the board is what the screen is for,
 * and stacking would scroll it away the moment anything else was read.
 *
 * **Dragging a move is "send to tree".** A move played on the board walks to the child that
 * is already there or creates it, in one gesture: whether the tree knew the move is the
 * server's problem (`POST /correspondence/nodes` is idempotent), not the reader's.
 *
 * Everything the page shows comes from one payload (`GET /correspondence/games/{id}`) and
 * every write is followed by `correspondence.updated` on the socket, which refetches it
 * whole — the tree, the move list and the deadlines are one document, so there is nothing
 * to patch in place and nothing that can be half-updated.
 */
import { Trans, useLingui } from '@lingui/react/macro'
import {
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  Download,
  FlipVertical2,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { Board, type BoardArrow, type Square } from '@/components/board/Board'
import { Frame } from '@/components/engine-dialog/DialogFrame'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group'
import { Skeleton } from '@/components/ui/skeleton'
import { TextLink } from '@/components/ui/text-link'
import { saveDownload } from '@/lib/api/client'
import { SETTING_DEFAULTS } from '@/lib/api/appSettings'
import {
  useAddCorrespondenceNode,
  useAppSettings,
  useCancelCorrespondenceTask,
  useCorrespondenceGame,
  useCorrespondenceGames,
  useCorrespondenceStatus,
  useDeleteCorrespondenceNode,
  useExpandCorrespondenceNode,
  useExportCorrespondencePgn,
  useFinishCorrespondenceGame,
  usePauseCorrespondenceSearch,
  usePlayCorrespondenceMove,
  useRefreshCorrespondenceSubtree,
  useResumeCorrespondenceSearch,
  useStartCorrespondenceSearch,
  useStopCorrespondenceSearch,
  useUndoCorrespondenceMove,
  useUpdateCorrespondenceGame,
  useUpdateCorrespondenceNode,
} from '@/lib/api/queries'
import type { CorrespondenceTreeNode, Result } from '@/lib/api/types'
import { useLinePreview, type HoveredLine } from '@/lib/board/useLinePreview'
import { useLinePreviewPrefs } from '@/lib/board/linePreviewPrefs'
import { whiteWinPercent } from '@/lib/chess/evaluation'
import { toast } from '@/lib/toast'
import { useIsMobile } from '@/lib/ui/media'
import { isTyping } from '@/lib/ui/shortcuts'
import { cn } from '@/lib/utils'
import { EvalBar } from '@/routes/game/components/EvalBar'
import { PaneTab, PaneTabList } from '@/routes/game/components/PaneTabList'
import { STRIP_FACTS, STRIP_RULE, TAB_ROW } from '@/routes/game/components/paneTabs'

import { BookPane, type BookSource } from './components/BookPane'
import { EnginesPane } from './components/EnginesPane'
import { ExpandDialog } from './components/ExpandDialog'
import { FinishDialog, GameHeader, OpponentMoveDialog } from './components/GameHeader'
import { NotesPane, type NotesTab } from './components/NotesPane'
import { SearchDialog } from './components/SearchDialog'
import { TaskDialog } from './components/TaskDialog'
import { TreePane } from './components/TreePane'
import { neighbours, opponentOf } from './format'
import { destsFor, uciFor } from './moves'
import { countPruned, prunableNodes } from './searches'
import {
  countEvaluated,
  countNodes,
  inWhiteFrame,
  indexTree,
  mainlineFrom,
  nextSelection,
  playedPath,
  sortSiblings,
  type ArrowKey,
} from './tree'

type MobilePane = 'board' | 'tree' | 'engines' | 'notes'

const ARROWS: ArrowKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']

/**
 * The pane title strip every column wears, in the game screen's strip order: the name,
 * then its facts (`STRIP_FACTS`), then a rule and the tools hard right — small secondary
 * faces for commands, a ghost square for an icon-only one. A ghost *word* is not a button
 * the grammar allows: "Expand…" drawn as bare text had read as a label.
 */
function PaneTitle({
  title,
  detail,
  end,
}: {
  title: ReactNode
  detail?: ReactNode
  end?: ReactNode
}) {
  return (
    <div className="flex h-[2.1875rem] flex-none items-center gap-2 border-b border-line bg-panel px-2.5 text-label">
      {/* Only the detail gives way on a narrow column: it is a count the pane itself shows,
          while the title names the pane and the actions at the end are the only way to them. */}
      <strong className="flex-none font-semibold text-ink">{title}</strong>
      {detail ? <span className={cn(STRIP_FACTS, 'min-w-0 truncate')}>{detail}</span> : null}
      {end ? (
        <div className="ml-auto flex flex-none items-center gap-1.5">
          <span aria-hidden className={cn(STRIP_RULE, 'mr-0.5')} />
          {end}
        </div>
      ) : null}
    </div>
  )
}

export function CorrespondenceGamePage() {
  const params = useParams<{ id: string }>()
  // Keyed on the game: stepping to the next one with `[` or `]` must not carry this one's
  // selection, flip, open dialog or hovered line over to a tree they mean nothing in.
  return <CorrespondenceGameView key={params.id} />
}

function CorrespondenceGameView() {
  const { t } = useLingui()
  const params = useParams<{ id: string }>()
  const gameId = Number(params.id)
  const detail = useCorrespondenceGame(Number.isFinite(gameId) ? gameId : null)
  const navigate = useNavigate()
  // The list, for the games either side of this one. The same query the list page reads,
  // so coming from there it is already in the cache.
  const games = useCorrespondenceGames()
  const walk = useMemo(
    () => (games.data?.games ? neighbours(games.data.games, gameId) : null),
    [games.data, gameId],
  )
  const mobile = useIsMobile()
  const prefs = useLinePreviewPrefs()

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [dialog, setDialog] = useState<
    'opponent' | 'finish' | 'search' | 'task' | 'refresh' | 'expand' | 'prune' | null
  >(null)
  /** The node the search or expand dialog is about, which need not be the selected one. */
  const [searchNodeId, setSearchNodeId] = useState<number | null>(null)
  const [notesTab, setNotesTab] = useState<NotesTab>('position')
  const [bookSource, setBookSource] = useState<BookSource>('masters')
  const [pane, setPane] = useState<MobilePane>('board')
  const [hover, setHover] = useState<HoveredLine | null>(null)
  /** The tree row the pointer is on: the board shows its position while it lasts. */
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const updateGame = useUpdateCorrespondenceGame()
  const playMove = usePlayCorrespondenceMove({ onSuccess: () => setDialog(null) })
  const undoMove = useUndoCorrespondenceMove()
  const finish = useFinishCorrespondenceGame({ onSuccess: () => setDialog(null) })
  const addNode = useAddCorrespondenceNode()
  const updateNode = useUpdateCorrespondenceNode()
  const deleteNode = useDeleteCorrespondenceNode()
  const exportPgn = useExportCorrespondencePgn({ onSuccess: (file) => saveDownload(file) })
  const startSearch = useStartCorrespondenceSearch({ onSuccess: () => setDialog(null) })
  const pauseSearch = usePauseCorrespondenceSearch()
  const resumeSearch = useResumeCorrespondenceSearch()
  const stopSearch = useStopCorrespondenceSearch()
  const cancelTask = useCancelCorrespondenceTask()
  // The counts are worth saying out loud: an expansion over moves that were already in the
  // tree makes nothing and still queues the engines, and a page that stayed silent would
  // read as a button that did nothing. The tree itself arrives on `correspondence.updated`.
  const expand = useExpandCorrespondenceNode({
    onSuccess: (answer) => {
      setDialog(null)
      toast.success(
        answer.created > 0 && answer.queued > 0
          ? t`${answer.created} positions added, ${answer.queued} queued for an engine.`
          : answer.created > 0
            ? t`${answer.created} positions added.`
            : answer.queued > 0
              ? // The fresh-branch case: nothing could be made yet, and one task carries
                // the whole expansion until it answers.
                t`${answer.queued} positions queued for an engine.`
              : t`Those moves were already in the tree.`,
      )
    },
  })
  const refresh = useRefreshCorrespondenceSubtree({
    onSuccess: (answer) => {
      setDialog(null)
      toast.success(
        answer.queued > 0
          ? t`${answer.queued} stale positions queued for an engine.`
          : t`Nothing under there is stale.`,
      )
    },
  })
  /**
   * Open one of the engine dialogs on a node, forgetting the last refusal.
   *
   * Search and task share one mutation, so a task the deployment could not queue would
   * otherwise greet the next opening of the search dialog with an error about something
   * the owner did somewhere else — and the other way round.
   */
  const openOn = (nodeId: number, which: 'search' | 'task' | 'refresh' | 'expand') => {
    startSearch.reset()
    refresh.reset()
    setSearchNodeId(nodeId)
    setDialog(which)
  }
  // The pickers' engines and the deployment's default line counts. Both are read once and
  // are what the dialogs are filled from; neither is worth a request per open.
  const status = useCorrespondenceStatus()
  const settings = useAppSettings()

  const game = detail.data?.game ?? null
  const tree = detail.data?.tree ?? null
  const index = useMemo(() => indexTree(tree), [tree])

  // The selection follows the payload: a node that no longer exists (a subtree deleted, a
  // move taken back) falls back to the position the game stands in rather than leaving the
  // board on something that is gone.
  const tipId = game?.current_node_id ?? tree?.id ?? null
  useEffect(() => {
    if (!tree) return
    setSelectedId((current) =>
      current !== null && index.has(current) ? current : (tipId ?? tree.id),
    )
  }, [tree, index, tipId])

  const selected = selectedId !== null ? (index.get(selectedId)?.node ?? null) : null
  // The search dialog stands on the node its verb was raised from, which is the selected
  // one from the column's button and the right-clicked one from the tree's menu.
  const searchNode = searchNodeId !== null ? (index.get(searchNodeId)?.node ?? null) : null
  const node = selected ?? tree
  // What the board column draws: the hovered row's node while the pointer is on one, else
  // the selected. Kept off `node` itself, because everything else on the page — the
  // engines, the notes, the book, the verbs — stays on the selection; only the board
  // follows the pointer.
  const hovered = hoveredId !== null ? (index.get(hoveredId)?.node ?? null) : null
  const played = useMemo(() => playedPath(tree), [tree])
  const tip = played.at(-1) ?? tree

  const select = useCallback((id: number) => {
    setSelectedId(id)
    setHover(null)
  }, [])

  /** Arrow keys walk the tree: along the line, and across the sibling set. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      // A tab strip or a segmented choice has already used the arrow to move between its
      // own options; it must not walk the tree as well.
      if (event.defaultPrevented) return
      if (document.querySelector('[role="dialog"]')) return
      if (!ARROWS.includes(event.key as ArrowKey)) return
      setSelectedId((current) => {
        if (current === null) return current
        const next = nextSelection(index, current, event.key as ArrowKey)
        if (next !== current) event.preventDefault()
        return next
      })
      setHover(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index])

  /** `[` and `]` step through the list, as they step through the library on a game. */
  const previousGame = walk?.previous ?? null
  const nextGame = walk?.next ?? null
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target) || event.defaultPrevented) return
      if (document.querySelector('[role="dialog"]')) return
      const to = event.key === '[' ? previousGame : event.key === ']' ? nextGame : null
      if (to === null) return
      event.preventDefault()
      void navigate(`/correspondence/${to}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previousGame, nextGame, navigate])

  /**
   * One move into the tree from the selected node. The child that is already there is
   * walked to; anything else is created and selected — one gesture for both, which is what
   * "send to tree" means, and the same gesture whether the move came off the board or off a
   * row in the book.
   */
  const playInto = useCallback(
    (uci: string) => {
      if (!node || game?.finished) return
      const existing = node.children.find((child) => child.uci === uci)
      if (existing) {
        select(existing.id)
        return
      }
      addNode.mutate(
        { parent_id: node.id, uci },
        { onSuccess: (added) => select(added.tip.id) },
      )
    },
    [node, game?.finished, addNode, select],
  )

  const onBoardMove = useCallback(
    (orig: Square, dest: Square) => {
      if (!node) return
      const uci = uciFor(node.fen, orig, dest)
      if (uci) playInto(uci)
    },
    [node, playInto],
  )

  const dests = useMemo(
    () => (node && !game?.finished ? destsFor(node.fen) : new Map<Square, Square[]>()),
    [node, game?.finished],
  )

  // The shown node's children as arrows: the first one in the strong brush, the rest
  // pale. It is the tree's next level drawn on the board, and what the board shows until a
  // hovered engine line takes over.
  const arrows = useMemo<BoardArrow[]>(
    () =>
      sortSiblings((hovered ?? node)?.children ?? []).map((child, position) => ({
        from: (child.uci ?? '').slice(0, 2),
        to: (child.uci ?? '').slice(2, 4),
        color: position === 0 ? 'accent' : 'paleAccent',
      })),
    [hovered, node],
  )

  const preview = useLinePreview(node?.fen ?? null, hover, prefs, node?.ply ?? 0)

  /** What Prune weak would delete, worked out once per payload rather than per render. */
  const prunable = useMemo(() => prunableNodes(tree), [tree])

  if (!Number.isFinite(gameId)) {
    return <Missing />
  }

  if (detail.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
        <Skeleton className="h-14 w-full" data-testid="correspondence-game-loading" />
        <Skeleton className="min-h-0 flex-1 w-full" />
      </div>
    )
  }

  if (detail.error || !game || !node || !tree) {
    return <Missing message={detail.error?.message} />
  }

  const busy =
    playMove.isPending || undoMove.isPending || finish.isPending || updateGame.isPending
  const writeError =
    addNode.error ??
    updateNode.error ??
    deleteNode.error ??
    updateGame.error ??
    undoMove.error ??
    pauseSearch.error ??
    resumeSearch.error ??
    stopSearch.error ??
    cancelTask.error

  /** The candidate the header would play: a child of the position the game stands in. */
  const playable =
    selected && tip && selected.parent_id === tip.id && !selected.played ? selected : null

  // A hovered tree row and a hovered engine line cannot both be under the pointer, so the
  // two never compete; the tree's node wins on the off chance a stale one lingers.
  const shown = hovered ?? node
  const boardFen = hovered ? hovered.fen : (preview.fen ?? node.fen)
  const boardLastMove = hovered
    ? (hovered.uci ?? null)
    : preview.fen
      ? preview.lastMove
      : (node.uci ?? null)
  // The bar is White's point of view — its fills, its percentage and the number in its
  // tooltip alike — so the node's own number is turned out of the mover's frame first.
  // Handing it the tree's number unturned would print "−0.40 · White 56%" on every node a
  // Black move reached.
  const boardScore = inWhiteFrame(shown.own, shown.frame)
  const win = boardScore ? whiteWinPercent(boardScore) : null
  const orientation = flipped
    ? game.owner_color === 'black'
      ? 'white'
      : 'black'
    : game.owner_color === 'black'
      ? 'black'
      : 'white'

  const boardColumn = (
    <div className="flex min-h-0 flex-col bg-surface">
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div className="flex w-full max-w-[34rem] gap-2">
          <EvalBar win={win} score={boardScore} orientation={orientation} />
          <Board
            className="min-w-0 flex-1"
            fen={boardFen}
            orientation={orientation}
            lastMove={boardLastMove}
            arrows={!hovered && preview.shapes.length > 0 ? [] : arrows}
            shapes={hovered ? [] : preview.shapes}
            turnColor={shown.turn}
            viewOnly={Boolean(game.finished)}
            dests={dests}
            onMove={game.finished ? undefined : onBoardMove}
          />
        </div>
      </div>
      {/* The transport is one "do one of these" group of faced cells, as on the game
          screen; flipping is a different kind of thing, so it stands apart. */}
      <div className="flex flex-none items-center justify-center gap-1.5 border-t border-line bg-panel py-1.5">
        <ButtonGroup label={t`Move navigation`} size="xs">
          <ButtonGroupItem
            aria-label={t`Back to the start`}
            title={t`Back to the start`}
            onClick={() => select(tree.id)}
          >
            <ChevronsLeft aria-hidden className="size-3.5" />
          </ButtonGroupItem>
          <ButtonGroupItem
            aria-label={t`Previous move`}
            title={t`Previous move (←)`}
            onClick={() => select(nextSelection(index, node.id, 'ArrowLeft'))}
          >
            <ChevronLeft aria-hidden className="size-3.5" />
          </ButtonGroupItem>
          <ButtonGroupItem
            aria-label={t`Next move`}
            title={t`Next move (→)`}
            onClick={() => select(nextSelection(index, node.id, 'ArrowRight'))}
          >
            <ChevronRight aria-hidden className="size-3.5" />
          </ButtonGroupItem>
          <ButtonGroupItem
            aria-label={t`End of this line`}
            title={t`End of this line`}
            onClick={() => select(mainlineFrom(node).at(-1)?.id ?? node.id)}
          >
            <ChevronsRight aria-hidden className="size-3.5" />
          </ButtonGroupItem>
        </ButtonGroup>
        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          aria-label={t`Flip the board`}
          title={t`Flip the board`}
          onClick={() => setFlipped((was) => !was)}
        >
          <FlipVertical2 aria-hidden />
        </Button>
        <span className="ml-2 font-mono text-meta text-dim">
          {preview.caption ?? (node.uci ? `${node.san} · ${t`ply ${node.ply}`}` : t`start`)}
        </span>
        {/* The board's own verdict on the position, where the caption is: a mate or a draw
            by rule is a fact about the node, and the notes pane below is about the owner's
            writing on it. */}
        {node.flags?.checkmate ? (
          <span className="font-mono text-meta text-blunder">
            · <Trans>checkmate</Trans>
          </span>
        ) : node.flags?.stalemate ? (
          <span className="font-mono text-meta text-mistake">
            · <Trans>stalemate</Trans>
          </span>
        ) : node.flags?.threefold ? (
          <span className="font-mono text-meta text-mistake">
            · <Trans>threefold</Trans>
          </span>
        ) : node.flags?.fifty_move ? (
          <span className="font-mono text-meta text-mistake">
            · <Trans>fifty-move draw</Trans>
          </span>
        ) : null}
      </div>
    </div>
  )

  const treeColumn = (
    <div className="flex min-h-0 flex-col border-r border-edge-strong bg-surface max-md:border-r-0">
      <PaneTitle
        title={<Trans>Tree</Trans>}
        detail={t`${countNodes(tree)} positions · ${countEvaluated(tree)} evaluated`}
        end={
          <>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={Boolean(game.finished) || node.mark === 'excluded'}
              title={
                game.finished
                  ? t`A finished game's tree is read-only`
                  : node.mark === 'excluded'
                    ? t`An excluded move is never expanded`
                    : t`Make the best moves after the selected position into branches, with an engine on each`
              }
              onClick={() => openOn(node.id, 'expand')}
            >
              <Trans>Expand…</Trans>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              disabled={Boolean(game.finished) || prunable.length === 0}
              title={
                game.finished
                  ? t`A finished game's tree is read-only`
                  : prunable.length === 0
                    ? t`Nothing in this tree has fallen far enough behind to prune`
                    : t`Delete the faded lines — never automatic, and always after a confirm`
              }
              onClick={() => setDialog('prune')}
            >
              <Trans>Prune weak…</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t`Export PGN`}
              title={t`Export PGN`}
              disabled={exportPgn.isPending}
              onClick={() => exportPgn.mutate(game.game_id)}
            >
              <Download aria-hidden />
            </Button>
          </>
        }
      />
      <TreePane
        tree={tree}
        selectedId={selectedId}
        readOnly={Boolean(game.finished)}
        onSelect={select}
        onHover={setHoveredId}
        onMark={(id, mark) => updateNode.mutate({ id, body: { mark } })}
        onComment={(commented) => {
          select(commented.id)
          setNotesTab('position')
          setPane('notes')
        }}
        onPromote={(id) => updateNode.mutate({ id, body: { promote: true } })}
        onDelete={(id) => deleteNode.mutate(id)}
        onFold={(id, collapsed) => updateNode.mutate({ id, body: { collapsed } })}
        onSearch={game.finished ? undefined : (searched) => openOn(searched.id, 'search')}
        onQueueTask={game.finished ? undefined : (asked) => openOn(asked.id, 'task')}
        onExpand={game.finished ? undefined : (expanded) => openOn(expanded.id, 'expand')}
        onRefresh={game.finished ? undefined : (refreshed) => openOn(refreshed.id, 'refresh')}
        onCancelTask={game.finished ? undefined : (searchId) => cancelTask.mutate(searchId)}
      />
    </div>
  )

  const enginesColumn = (
    <div className="flex min-h-0 flex-col bg-surface">
      <PaneTitle
        title={<Trans>Engines</Trans>}
        detail={node.san ? `· ${node.san}` : undefined}
        end={
          <Button
            type="button"
            variant="secondary"
            size="xs"
            disabled={Boolean(game.finished)}
            title={
              game.finished
                ? t`A finished game's tree is read-only`
                : t`Put one engine on this position for as long as you let it`
            }
            onClick={() => openOn(node.id, 'search')}
          >
            <Trans>Search with…</Trans>
          </Button>
        }
      />
      <EnginesPane
        node={node}
        previewLine={preview.line}
        onHover={setHover}
        onPause={(id) => pauseSearch.mutate(id)}
        onResume={(id) => resumeSearch.mutate(id)}
        onStop={(id) => stopSearch.mutate(id)}
        onCancel={(id) => cancelTask.mutate(id)}
        onPin={
          game.finished
            ? undefined
            : (engineId) =>
                updateNode.mutate({ id: node.id, body: { pinned_engine_id: engineId } })
        }
        busy={
          pauseSearch.isPending ||
          resumeSearch.isPending ||
          stopSearch.isPending ||
          cancelTask.isPending
        }
      />
    </div>
  )

  const notesColumn = (
    <div className="flex min-h-0 flex-col border-t border-edge-strong bg-surface max-md:border-t-0">
      <NotesPane
        gameId={game.game_id}
        node={node}
        tab={notesTab}
        onTabChange={setNotesTab}
        commentPending={updateNode.isPending}
        readOnly={Boolean(game.finished)}
        onComment={(id, comment) => updateNode.mutate({ id, body: { comment } })}
        book={
          <BookPane
            node={node}
            source={bookSource}
            onSourceChange={setBookSource}
            onPlay={game.finished ? () => {} : playInto}
            // A book row rides the same preview machinery a candidate does; the id is a
            // constant nothing else uses, because the line is the book's and not a node's.
            onPreview={(line) => setHover(line ? { line: 'book', ply: null, pv: line } : null)}
          />
        }
      />
    </div>
  )

  const chrome = (
    <SetPageChrome
      breadcrumb={[
        { label: t`Correspondence`, to: '/correspondence' },
        { label: opponentOf(game) },
      ]}
      back={{ label: t`Correspondence`, to: '/correspondence' }}
      manual="guide/correspondence"
    />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chrome}
      <GameHeader
        game={game}
        playable={playable}
        busy={busy}
        onDue={(iso) => updateGame.mutate({ gameId: game.game_id, body: { reply_due: iso } })}
        onOpponentMove={() => setDialog('opponent')}
        onPlay={(uci) => playMove.mutate({ gameId: game.game_id, uci })}
        onUndo={() => undoMove.mutate(game.game_id)}
        onFinish={() => setDialog('finish')}
        walk={
          walk
            ? {
                onPrevious:
                  walk.previous !== null
                    ? () => void navigate(`/correspondence/${walk.previous}`)
                    : null,
                onNext: walk.next !== null ? () => void navigate(`/correspondence/${walk.next}`) : null,
              }
            : null
        }
      />

      {writeError ? (
        <p role="alert" className="flex-none bg-blunder/5 px-4 py-1.5 text-label text-blunder">
          {writeError.message}
        </p>
      ) : null}

      {mobile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* The phone's four panes are the game screen's folder tabs, sharing the width. */}
          <div className={cn(TAB_ROW, 'pr-0')}>
            <PaneTabList label={t`Panes`} className="flex-1">
              {(['board', 'tree', 'engines', 'notes'] as MobilePane[]).map((each) => (
                <PaneTab
                  key={each}
                  id={`correspondence-pane-tab-${each}`}
                  controls="correspondence-pane"
                  selected={pane === each}
                  onSelect={() => setPane(each)}
                  className="flex-1 justify-center"
                >
                  {each === 'board' ? (
                    <Trans>Board</Trans>
                  ) : each === 'tree' ? (
                    <Trans>Tree</Trans>
                  ) : each === 'engines' ? (
                    <Trans>Engines</Trans>
                  ) : (
                    <Trans>Notes</Trans>
                  )}
                </PaneTab>
              ))}
            </PaneTabList>
          </div>
          <div
            id="correspondence-pane"
            role="tabpanel"
            aria-labelledby={`correspondence-pane-tab-${pane}`}
            className="flex min-h-0 flex-1 flex-col"
          >
            {pane === 'board' ? boardColumn : null}
            {pane === 'tree' ? treeColumn : null}
            {pane === 'engines' ? enginesColumn : null}
            {pane === 'notes' ? notesColumn : null}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.15fr)_minmax(18rem,0.95fr)] bg-void">
          {/* The board keeps its square and the notes take what is left under it, never
              less than a heading and a few lines: on a short window the board gives way,
              not the writing.

              The three minimums fit the 1200 px a 1440 window leaves beside the rail. They
              had added up to more than that, so the engine column was cut off at the right
              and the tree's move column squeezed to nothing; now the tree takes what is
              left and scrolls sideways inside its own pane when that is too little. */}
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(12rem,0.8fr)] border-r border-edge-strong">
            {boardColumn}
            {notesColumn}
          </div>
          {treeColumn}
          {enginesColumn}
        </div>
      )}

      {dialog === 'opponent' && tip ? (
        <OpponentMoveDialog
          tip={tip}
          pending={playMove.isPending}
          error={playMove.error?.message ?? null}
          onPlay={(uci) => playMove.mutate({ gameId: game.game_id, uci })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'finish' ? (
        <FinishDialog
          pending={finish.isPending}
          error={finish.error?.message ?? null}
          onFinish={(result: Result, termination) =>
            finish.mutate({ gameId: game.game_id, body: { result, termination } })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'search' && searchNode ? (
        <SearchDialog
          node={searchNode}
          engines={status.data?.engines ?? []}
          defaultMultipv={
            settings.data?.correspondence_multipv ?? SETTING_DEFAULTS.correspondence_multipv
          }
          pending={startSearch.isPending}
          error={startSearch.error?.message ?? null}
          onStart={(body) => startSearch.mutate(body)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {(dialog === 'task' || dialog === 'refresh') && searchNode ? (
        <TaskDialog
          node={searchNode}
          verb={dialog}
          engines={status.data?.engines ?? []}
          pending={dialog === 'task' ? startSearch.isPending : refresh.isPending}
          error={
            dialog === 'task'
              ? (startSearch.error?.message ?? null)
              : (refresh.error?.message ?? null)
          }
          onQueue={(engineId) =>
            dialog === 'task'
              ? startSearch.mutate({ node_id: searchNode.id, kind: 'task', engine_id: engineId })
              : refresh.mutate({ id: searchNode.id, body: { engine_id: engineId } })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'expand' && searchNode ? (
        <ExpandDialog
          node={searchNode}
          engines={status.data?.engines ?? []}
          defaultWidth={
            settings.data?.correspondence_task_multipv ??
            SETTING_DEFAULTS.correspondence_task_multipv
          }
          pending={expand.isPending}
          error={expand.error?.message ?? null}
          onExpand={(body) => expand.mutate({ id: searchNode.id, body })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'prune' ? (
        <PruneDialog
          nodes={prunable}
          pending={deleteNode.isPending}
          error={deleteNode.error?.message ?? null}
          onPrune={() => {
            for (const doomed of prunable) deleteNode.mutate(doomed.id)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * **Prune weak**, behind a confirm and never automatic.
 *
 * The tree is the thing the mode accumulates, and a line faded today can be the
 * transposition that matters next week — so nothing is ever deleted because a number said
 * so. The dialog names exactly what would go, and the moves themselves, because "12
 * positions" is not something anyone can check.
 */
function PruneDialog({
  nodes,
  pending,
  error,
  onPrune,
  onClose,
}: {
  nodes: CorrespondenceTreeNode[]
  pending: boolean
  error: string | null
  onPrune: () => void
  onClose: () => void
}) {
  const { t } = useLingui()
  const total = countPruned(nodes)
  return (
    <Frame
      labelledBy="correspondence-prune-title"
      title={t`Prune the weak lines`}
      onClose={onClose}
      description={t`${nodes.length} lines and everything under them — ${total} positions in all. Their evaluations stay in the library; only these nodes go.`}
    >
      {/* The moves that would go are facts, so borderless tints, not boxes. */}
      <ul className="flex flex-wrap gap-1.5">
        {nodes.map((node) => (
          <li key={node.id}>
            <Badge size="md" className="font-mono text-soft">
              {node.san ?? node.uci}
            </Badge>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-label text-blunder">
          {error}
        </p>
      ) : null}
      {/* A confirm dialog: the one place the filled red button belongs. */}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={onPrune}>
          <Trash2 aria-hidden />
          <Trans>Prune</Trans>
        </Button>
      </div>
    </Frame>
  )
}

function Missing({ message }: { message?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-start gap-2 p-6">
      <p className="text-lead text-ink">
        <Trans>That correspondence game is not here.</Trans>
      </p>
      {message ? <p className="font-mono text-label text-dim">{message}</p> : null}
      <TextLink to="/correspondence" className="text-data">
        <Trans>Back to the list</Trans>
      </TextLink>
    </div>
  )
}

