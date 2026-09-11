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
import { ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, Download, FlipVertical2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Board, type BoardArrow, type Square } from '@/components/board/Board'
import { SetPageChrome } from '@/components/shell/PageChrome'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { saveDownload } from '@/lib/api/client'
import { SETTING_DEFAULTS } from '@/lib/api/appSettings'
import {
  useAddCorrespondenceNode,
  useAppSettings,
  useCancelCorrespondenceTask,
  useCorrespondenceGame,
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

import { BookPane, type BookSource } from './components/BookPane'
import { Frame } from './components/DialogFrame'
import { EnginesPane } from './components/EnginesPane'
import { ExpandDialog } from './components/ExpandDialog'
import { FinishDialog, GameHeader, OpponentMoveDialog } from './components/GameHeader'
import { NotesPane, type NotesTab } from './components/NotesPane'
import { SearchDialog } from './components/SearchDialog'
import { TreePane } from './components/TreePane'
import { opponentOf } from './format'
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

/** The pane title strip every column wears — chrome, a rule, and whatever sits hard right. */
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
    <div className="flex h-[2.1875rem] flex-none items-center gap-2 border-b border-line bg-panel px-2.5 text-[0.6875rem]">
      <strong className="font-semibold text-ink">{title}</strong>
      {detail ? <span className="truncate text-dim">{detail}</span> : null}
      {end ? <div className="ml-auto flex items-center gap-1.5">{end}</div> : null}
    </div>
  )
}

export function CorrespondenceGamePage() {
  const { t } = useLingui()
  const params = useParams<{ id: string }>()
  const gameId = Number(params.id)
  const detail = useCorrespondenceGame(Number.isFinite(gameId) ? gameId : null)
  const mobile = useIsMobile()
  const prefs = useLinePreviewPrefs()

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [dialog, setDialog] = useState<
    'opponent' | 'finish' | 'search' | 'expand' | 'prune' | null
  >(null)
  /** The node the search or expand dialog is about, which need not be the selected one. */
  const [searchNodeId, setSearchNodeId] = useState<number | null>(null)
  const [notesTab, setNotesTab] = useState<NotesTab>('position')
  const [bookSource, setBookSource] = useState<BookSource>('masters')
  const [pane, setPane] = useState<MobilePane>('board')
  const [hover, setHover] = useState<HoveredLine | null>(null)

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
    onSuccess: (answer) =>
      toast.success(
        answer.queued > 0
          ? t`${answer.queued} stale positions queued for an engine.`
          : t`Nothing under there is stale.`,
      ),
    onError: (failed) => toast.error(failed.message),
  })
  /** Open the search picker on a node, forgetting the last refusal.
   *
   * "Queue task" in the tree menu drives the same mutation without a dialog, so a task the
   * deployment could not queue would otherwise greet the next opening of this dialog with
   * an error about something the owner did somewhere else.
   */
  const openSearch = (nodeId: number) => {
    startSearch.reset()
    setSearchNodeId(nodeId)
    setDialog('search')
  }
  // The picker's engines and the deployment's default line count. Both are read once and
  // are what the search dialog is filled from; neither is worth a request per open.
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

  // The selected node's children as arrows: the first one in the strong brush, the rest
  // pale. It is the tree's next level drawn on the board, and what the board shows until a
  // hovered engine line takes over.
  const arrows = useMemo<BoardArrow[]>(
    () =>
      sortSiblings(node?.children ?? []).map((child, position) => ({
        from: (child.uci ?? '').slice(0, 2),
        to: (child.uci ?? '').slice(2, 4),
        color: position === 0 ? 'accent' : 'paleAccent',
      })),
    [node],
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

  const boardFen = preview.fen ?? node.fen
  const boardLastMove = preview.fen ? preview.lastMove : (node.uci ?? null)
  // The bar is White's point of view — its fills, its percentage and the number in its
  // tooltip alike — so the node's own number is turned out of the mover's frame first.
  // Handing it the tree's number unturned would print "−0.40 · White 56%" on every node a
  // Black move reached.
  const boardScore = inWhiteFrame(node.own, node.frame)
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
            arrows={preview.shapes.length > 0 ? [] : arrows}
            shapes={preview.shapes}
            turnColor={node.turn}
            viewOnly={Boolean(game.finished)}
            dests={dests}
            onMove={game.finished ? undefined : onBoardMove}
          />
        </div>
      </div>
      <div className="flex flex-none items-center justify-center gap-1.5 border-t border-line bg-panel py-1.5">
        <Control
          label={t`Back to the start`}
          onClick={() => select(tree.id)}
          icon={<ChevronsLeft aria-hidden />}
        />
        <Control
          label={t`Previous move`}
          onClick={() => select(nextSelection(index, node.id, 'ArrowLeft'))}
          icon={<ChevronLeft aria-hidden />}
        />
        <Control
          label={t`Next move`}
          onClick={() => select(nextSelection(index, node.id, 'ArrowRight'))}
          icon={<ChevronRight aria-hidden />}
        />
        <Control
          label={t`End of this line`}
          onClick={() => select(mainlineFrom(node).at(-1)?.id ?? node.id)}
          icon={<ChevronsRight aria-hidden />}
        />
        <Control
          label={t`Flip the board`}
          onClick={() => setFlipped((was) => !was)}
          icon={<FlipVertical2 aria-hidden />}
        />
        <span className="ml-2 font-mono text-[0.625rem] text-dim">
          {preview.caption ?? (node.uci ? `${node.san} · ${t`ply ${node.ply}`}` : t`start`)}
        </span>
        {/* The board's own verdict on the position, where the caption is: a mate or a draw
            by rule is a fact about the node, and the notes pane below is about the owner's
            writing on it. */}
        {node.flags?.checkmate ? (
          <span className="font-mono text-[0.625rem] text-blunder">
            · <Trans>checkmate</Trans>
          </span>
        ) : node.flags?.stalemate ? (
          <span className="font-mono text-[0.625rem] text-mistake">
            · <Trans>stalemate</Trans>
          </span>
        ) : node.flags?.threefold ? (
          <span className="font-mono text-[0.625rem] text-mistake">
            · <Trans>threefold</Trans>
          </span>
        ) : node.flags?.fifty_move ? (
          <span className="font-mono text-[0.625rem] text-mistake">
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
              variant="ghost"
              size="sm"
              disabled={Boolean(game.finished) || node.mark === 'excluded'}
              title={t`Make the best moves after the selected position into branches, with an engine on each`}
              onClick={() => {
                setSearchNodeId(node.id)
                setDialog('expand')
              }}
            >
              <Trans>Expand…</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={Boolean(game.finished) || prunable.length === 0}
              title={
                prunable.length === 0
                  ? t`Nothing in this tree has fallen far enough behind to prune`
                  : t`Delete the faded lines — never automatic, and always after a confirm`
              }
              onClick={() => setDialog('prune')}
            >
              <Trans>Prune weak</Trans>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={exportPgn.isPending}
              onClick={() => exportPgn.mutate(game.game_id)}
            >
              <Download aria-hidden />
              <Trans>Export PGN</Trans>
            </Button>
          </>
        }
      />
      <TreePane
        tree={tree}
        selectedId={selectedId}
        readOnly={Boolean(game.finished)}
        onSelect={select}
        onMark={(id, mark) => updateNode.mutate({ id, body: { mark } })}
        onComment={(commented) => {
          select(commented.id)
          setNotesTab('position')
          setPane('notes')
        }}
        onPromote={(id) => updateNode.mutate({ id, body: { promote: true } })}
        onDelete={(id) => deleteNode.mutate(id)}
        onFold={(id, collapsed) => updateNode.mutate({ id, body: { collapsed } })}
        onSearch={
          game.finished
            ? undefined
            : (searched) => openSearch(searched.id)
        }
        onQueueTask={
          game.finished
            ? undefined
            : (asked) => {
                select(asked.id)
                // No engine and no limits: a task takes the deployment's task engine, its
                // node budget and its line count, which is the whole difference between
                // asking for one and setting a search on a position.
                //
                // No dialog is open to hold the refusal, so it is toasted here: the first
                // thing this verb does on a deployment with no task engine and no deep role
                // is fail, and a menu item that silently did nothing would read as broken.
                startSearch.mutate(
                  { node_id: asked.id, kind: 'task' },
                  { onError: (failed) => toast.error(failed.message) },
                )
              }
        }
        onExpand={
          game.finished
            ? undefined
            : (expanded) => {
                setSearchNodeId(expanded.id)
                setDialog('expand')
              }
        }
        onRefresh={
          game.finished
            ? undefined
            : (refreshed) => refresh.mutate({ id: refreshed.id, body: {} })
        }
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
            variant="ghost"
            size="sm"
            disabled={Boolean(game.finished)}
            onClick={() => openSearch(node.id)}
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
      />

      {writeError ? (
        <p role="alert" className="flex-none bg-blunder/5 px-4 py-1.5 text-[0.6875rem] text-blunder">
          {writeError.message}
        </p>
      ) : null}

      {mobile ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-none border-b border-edge-strong bg-panel">
            {(['board', 'tree', 'engines', 'notes'] as MobilePane[]).map((each) => (
              <button
                key={each}
                type="button"
                aria-pressed={pane === each}
                onClick={() => setPane(each)}
                className={cn(
                  'flex-1 border-b-2 py-2 text-[0.6875rem] transition-colors',
                  pane === each
                    ? 'border-b-accent-teal text-ink'
                    : 'border-b-transparent text-dim hover:text-ink',
                )}
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
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {pane === 'board' ? boardColumn : null}
            {pane === 'tree' ? treeColumn : null}
            {pane === 'engines' ? enginesColumn : null}
            {pane === 'notes' ? notesColumn : null}
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(24rem,0.9fr)_minmax(22rem,1.15fr)_minmax(20rem,0.95fr)] bg-void">
          {/* The board keeps its square and the notes take what is left under it, never
              less than a heading and a few lines: on a short window the board gives way,
              not the writing. */}
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
      {dialog === 'expand' && searchNode ? (
        <ExpandDialog
          node={searchNode}
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
      <ul className="flex flex-wrap gap-1.5">
        {nodes.map((node) => (
          <li
            key={node.id}
            className="rounded-sm border border-edge px-1.5 py-0.5 font-mono text-[0.6875rem] text-dim"
          >
            {node.san ?? node.uci}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-[0.6875rem] text-blunder">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={onPrune}>
          <Trans>Prune</Trans>
        </Button>
      </div>
    </Frame>
  )
}

function Control({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-6 min-w-8 items-center justify-center rounded-md border border-edge bg-elevated text-body hover:bg-raised [&_svg]:size-3.5"
    >
      {icon}
    </button>
  )
}

function Missing({ message }: { message?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-start gap-2 p-6">
      <p className="text-[0.8125rem] text-ink">
        <Trans>That correspondence game is not here.</Trans>
      </p>
      {message ? <p className="font-mono text-[0.6875rem] text-dim">{message}</p> : null}
      <Link to="/correspondence" className="text-[0.75rem] text-accent-teal hover:text-accent-link">
        <Trans>Back to the list</Trans>
      </Link>
    </div>
  )
}

