/**
 * The Board page's one handle on its board, whichever side keeps it.
 *
 * On an ordinary deployment the board is the server's (`services/live.py`), shared with the
 * coach: every action is a `POST /live/*` whose answer — the whole new state — goes into the
 * `live` query, which is also where the `live.updated` frames land. A move is played in
 * `localBoard.ts` first so the piece does not wait on the request, and the server's answer
 * replaces it; a refusal puts the old state back.
 *
 * On a read-only deployment (the public demo) every such request would be refused, so the
 * board lives in this hook instead and the same actions are answered locally — the page
 * cannot tell the difference, which is the point.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import {
  gotoBoard,
  loadBoard,
  newBoard,
  playBoardMoves,
  resetLive,
  selectLivePosition,
} from '@/lib/api/endpoints'
import { queryKeys } from '@/lib/api/keys'
import { useLiveState } from '@/lib/api/queries'
import type { LiveState } from '@/lib/api/types'
import { useRuntimeCapabilities } from '@/lib/runtime/capabilities'

import { applyLocal, EMPTY_BOARD, type BoardAction } from './localBoard'

function send(action: BoardAction): Promise<LiveState> {
  switch (action.kind) {
    case 'new':
      return newBoard()
    case 'load':
      return loadBoard(action.input)
    case 'play':
      return playBoardMoves(action.ucis)
    case 'goto':
      return gotoBoard(action.ply, action.cursor)
    case 'select':
      return selectLivePosition(action.index)
    case 'reset':
      return resetLive()
  }
}

export interface BoardHandle {
  state: LiveState | undefined
  /** The first read of the server's board; never true for a board kept here. */
  loading: boolean
  loadError: Error | null
  act: (action: BoardAction, options?: { onSuccess?: () => void }) => void
  pending: boolean
  /** The last action's refusal, cleared by the next action or by `clearFailure`. */
  failure: Error | null
  clearFailure: () => void
  /** The board is kept in this tab, not on the server. */
  local: boolean
}

export function useBoard(): BoardHandle {
  const { read_only: local } = useRuntimeCapabilities()
  const client = useQueryClient()
  const server = useLiveState({ enabled: !local })
  const [kept, setKept] = useState<LiveState>(EMPTY_BOARD)
  const keptRef = useRef<LiveState>(EMPTY_BOARD)
  const [localFailure, setLocalFailure] = useState<Error | null>(null)

  const mutation = useMutation({
    mutationFn: send,
    onMutate: (action) => {
      const previous = client.getQueryData<LiveState>(queryKeys.live())
      if (action.kind === 'play') {
        try {
          client.setQueryData(queryKeys.live(), applyLocal(previous ?? EMPTY_BOARD, action))
        } catch {
          // Refused here, it will be refused there too — and said so by the server.
        }
      }
      return { previous }
    },
    onError: (_error, _action, context) => {
      if (context?.previous) client.setQueryData(queryKeys.live(), context.previous)
    },
    onSuccess: (data) => client.setQueryData(queryKeys.live(), data),
  })

  const { mutate, reset } = mutation
  const clearFailure = useCallback(() => {
    reset()
    setLocalFailure(null)
  }, [reset])
  const act = useCallback<BoardHandle['act']>(
    (action, options) => {
      if (!local) {
        mutate(action, { onSuccess: () => options?.onSuccess?.() })
        return
      }
      // Answered synchronously from the ref, so two quick moves never both start from the
      // state of the last render.
      try {
        const next = applyLocal(keptRef.current, action)
        keptRef.current = next
        setKept(next)
        setLocalFailure(null)
        options?.onSuccess?.()
      } catch (error) {
        setLocalFailure(error instanceof Error ? error : new Error(String(error)))
      }
    },
    [local, mutate],
  )

  if (local) {
    return {
      state: kept,
      loading: false,
      loadError: null,
      act,
      pending: false,
      failure: localFailure,
      clearFailure,
      local,
    }
  }
  return {
    state: server.data,
    loading: server.isPending,
    loadError: server.error,
    act,
    pending: mutation.isPending,
    failure: mutation.error,
    clearFailure,
    local,
  }
}
