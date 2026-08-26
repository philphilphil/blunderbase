/**
 * TanStack Query bindings over `endpoints.ts`.
 *
 * Nothing here polls: freshness comes from the `/events` socket, which invalidates these
 * keys (see `src/lib/events/invalidation.ts`). The one exception is the queue widget,
 * which keeps a slow poll as a floor for when the socket is down.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query'

import { ApiError } from './client'
import * as api from './endpoints'
import { queryKeys } from './keys'
import type {
  AnalysisRequest,
  AuthStatus,
  EngineCreate,
  EngineDeleteResult,
  EngineUpdate,
  GameFilters,
  ImportRequest,
  NoteCreate,
  NoteUpdate,
  RunnerCreate,
  RunnerUpdate,
  SampleRequest,
  Source,
  Tier,
} from './types'

type Options<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>

// --- auth -----------------------------------------------------------------

/**
 * The gate's single source of truth (`lib/auth/AuthProvider.tsx` derives the screen from
 * it). Every mutation below writes its answer straight into this key rather than
 * invalidating it: the routes all answer with the same `AuthStatus`, so a round trip to
 * ask what we were just told would only add a frame of the wrong screen.
 */
export function useAuthStatus(options?: Options<Awaited<ReturnType<typeof api.authStatus>>>) {
  return useQuery({ queryKey: queryKeys.auth(), queryFn: api.authStatus, ...options })
}

function useAuthMutation<Variables>(
  mutationFn: (variables: Variables) => Promise<AuthStatus>,
  options?: UseMutationOptions<AuthStatus, Error, Variables>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn,
    ...options,
    onSuccess: (...args) => {
      client.setQueryData(queryKeys.auth(), args[0])
      options?.onSuccess?.(...args)
    },
    onError: (...args) => {
      // The two 409s — logging in to a deployment with no password yet, setting one on a
      // deployment that already has one — both mean the screen we are on is out of date
      // about the *deployment*, not about the password. Asking again is the whole fix.
      if (args[0] instanceof ApiError && args[0].status === 409) {
        void client.invalidateQueries({ queryKey: queryKeys.auth() })
      }
      options?.onError?.(...args)
    },
  })
}

export function useLogin(options?: UseMutationOptions<AuthStatus, Error, string>) {
  return useAuthMutation((password: string) => api.login(password), options)
}

export function useSetupPassword(options?: UseMutationOptions<AuthStatus, Error, string>) {
  return useAuthMutation((password: string) => api.setupPassword(password), options)
}

/** The cookie is re-issued, so this browser stays signed in while every other one does not. */
export function useChangePassword(
  options?: UseMutationOptions<AuthStatus, Error, { current: string; next: string }>,
) {
  return useAuthMutation(
    ({ current, next }: { current: string; next: string }) => api.changePassword(current, next),
    options,
  )
}

/**
 * Signing out cannot fail: a 204 and a lost cookie are the same outcome as a network error
 * on the way to one, so both land on the login screen. Clearing what the session cached is
 * `AuthProvider`'s job, once the app has come off the screen.
 */
export function useLogout(options?: UseMutationOptions<void, Error, void>) {
  const client = useQueryClient()
  const signedOut = () =>
    client.setQueryData<AuthStatus>(queryKeys.auth(), { setup_required: false, authenticated: false })
  return useMutation({
    mutationFn: api.logout,
    ...options,
    onSuccess: (...args) => {
      signedOut()
      options?.onSuccess?.(...args)
    },
    onError: (...args) => {
      signedOut()
      options?.onError?.(...args)
    },
  })
}

// --- games ----------------------------------------------------------------

export function useGames(query: api.GameQuery = {}, options?: Options<Awaited<ReturnType<typeof api.listGames>>>) {
  return useQuery({
    queryKey: queryKeys.gameList(query),
    queryFn: () => api.listGames(query),
    ...options,
  })
}

export function useGameCards(
  query: api.GameQuery = {},
  options?: Options<Awaited<ReturnType<typeof api.listGameCards>>>,
) {
  return useQuery({
    queryKey: queryKeys.gameCards(query),
    queryFn: () => api.listGameCards(query),
    ...options,
  })
}

export function useGame(
  id: number,
  query: api.GameDetailQuery = {},
  options?: Options<Awaited<ReturnType<typeof api.getGame>>>,
) {
  return useQuery({
    queryKey: queryKeys.gameDetail(id, query),
    queryFn: () => api.getGame(id, query),
    ...options,
  })
}

// --- analysis -------------------------------------------------------------

export function useQueueStatus(options?: Options<Awaited<ReturnType<typeof api.getQueue>>>) {
  return useQuery({
    queryKey: queryKeys.queue(),
    queryFn: api.getQueue,
    refetchInterval: 15_000,
    ...options,
  })
}

export function useRuns(gameId: number, tier?: Tier, options?: Options<Awaited<ReturnType<typeof api.listRuns>>>) {
  return useQuery({
    queryKey: queryKeys.runs(gameId, tier),
    queryFn: () => api.listRuns(gameId, tier),
    ...options,
  })
}

export function useRunEvals(
  runId: number,
  window: { ply_start?: number; ply_end?: number } = {},
  options?: Options<Awaited<ReturnType<typeof api.getRunEvals>>>,
) {
  return useQuery({
    queryKey: queryKeys.runEvals(runId, window),
    queryFn: () => api.getRunEvals(runId, window),
    ...options,
  })
}

export function useRequestAnalysis(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.requestAnalysis>>, Error, AnalysisRequest>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: AnalysisRequest) => api.requestAnalysis(body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.analysis() })
      options?.onSuccess?.(...args)
    },
  })
}

// --- import ---------------------------------------------------------------

export function useImportJobs(
  query: { source?: Source; limit?: number } = {},
  options?: Options<Awaited<ReturnType<typeof api.listImportJobs>>>,
) {
  return useQuery({
    queryKey: queryKeys.importJobs(query),
    queryFn: () => api.listImportJobs(query),
    ...options,
  })
}

export function useStartImport(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.startImport>>,
    Error,
    { source: Source; body?: ImportRequest }
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ source, body }: { source: Source; body?: ImportRequest }) =>
      api.startImport(source, body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.imports() })
      options?.onSuccess?.(...args)
    },
  })
}

export function useUploadPgn(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.uploadPgn>>,
    Error,
    { pgn: string; wait?: boolean; max_games?: number }
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ pgn, ...query }: { pgn: string; wait?: boolean; max_games?: number }) =>
      api.uploadPgn(pgn, query),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.imports() })
      void client.invalidateQueries({ queryKey: queryKeys.games() })
      options?.onSuccess?.(...args)
    },
  })
}

// --- explorer -------------------------------------------------------------

export function useExplorer(
  query: api.ExplorerQuery = {},
  options?: Options<Awaited<ReturnType<typeof api.explore>>>,
) {
  return useQuery({
    queryKey: queryKeys.explorerTree(query),
    queryFn: () => api.explore(query),
    ...options,
  })
}

export function usePositionOccurrences(
  fen: string,
  query: { color?: 'white' | 'black'; limit?: number } = {},
  options?: Options<Awaited<ReturnType<typeof api.findPositions>>>,
) {
  return useQuery({
    queryKey: queryKeys.explorerPositions(fen, query),
    queryFn: () => api.findPositions(fen, query),
    ...options,
  })
}

// --- stats ----------------------------------------------------------------

export function useDimensions(options?: Options<Awaited<ReturnType<typeof api.listDimensions>>>) {
  return useQuery({ queryKey: queryKeys.statsDimensions(), queryFn: api.listDimensions, ...options })
}

export function useProfile(options?: Options<Awaited<ReturnType<typeof api.getProfile>>>) {
  return useQuery({ queryKey: queryKeys.statsProfile(), queryFn: api.getProfile, ...options })
}

export function useStats(
  dimension: string,
  filters: GameFilters = {},
  options?: Options<Awaited<ReturnType<typeof api.getStats>>>,
) {
  return useQuery({
    queryKey: queryKeys.statsDimension(dimension, filters),
    queryFn: () => api.getStats(dimension, filters),
    ...options,
  })
}

export function useWorstMoments(
  query: GameFilters & { days?: number; amount?: number } = {},
  options?: Options<Awaited<ReturnType<typeof api.getWorstMoments>>>,
) {
  return useQuery({
    queryKey: queryKeys.worstMoments(query),
    queryFn: () => api.getWorstMoments(query),
    ...options,
  })
}

// --- engines --------------------------------------------------------------

export function useEngines(
  enabledOnly = false,
  options?: Options<Awaited<ReturnType<typeof api.listEngines>>>,
) {
  return useQuery({
    queryKey: queryKeys.engineList(enabledOnly),
    queryFn: () => api.listEngines(enabledOnly),
    ...options,
  })
}

export function useTierStatus(options?: Options<Awaited<ReturnType<typeof api.listTierStatus>>>) {
  return useQuery({ queryKey: queryKeys.engineTiers(), queryFn: api.listTierStatus, ...options })
}

export function useAddEngine(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.addEngine>>, Error, EngineCreate>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: EngineCreate) => api.addEngine(body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.engines() })
      options?.onSuccess?.(...args)
    },
  })
}

export function useUpdateEngine(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.updateEngine>>,
    Error,
    { id: number; body: EngineUpdate }
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: EngineUpdate }) => api.updateEngine(id, body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.engines() })
      options?.onSuccess?.(...args)
    },
  })
}

/** Deleting an engine unqueues any of its queued analysis runs, so both rosters move. */
export function useDeleteEngine(
  options?: UseMutationOptions<EngineDeleteResult, Error, number>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteEngine(id),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.engines() })
      void client.invalidateQueries({ queryKey: queryKeys.runners() })
      void client.invalidateQueries({ queryKey: queryKeys.queue() })
      options?.onSuccess?.(...args)
    },
  })
}

export function useTestRunEngine(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.testRunEngine>>,
    Error,
    { id: number; body?: SampleRequest }
  >,
) {
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body?: SampleRequest }) => api.testRunEngine(id, body),
    ...options,
  })
}

// --- runners --------------------------------------------------------------

export function useRunners(options?: Options<Awaited<ReturnType<typeof api.listRunners>>>) {
  return useQuery({ queryKey: queryKeys.runnerList(), queryFn: api.listRunners, ...options })
}

/**
 * The join every runner-aware surface reads: `GET /engines` carries no `runner_id`, so
 * where an engine lives is only knowable from here (see `lib/engines/hosts.ts`).
 */
export function useRunnersStatus(
  options?: Options<Awaited<ReturnType<typeof api.getRunnersStatus>>>,
) {
  return useQuery({
    queryKey: queryKeys.runnersStatus(),
    queryFn: api.getRunnersStatus,
    ...options,
  })
}

/**
 * Registering a runner mints its token. The answer is deliberately *not* written into the
 * cache: the token exists in that one response and nowhere else, so it lives in the
 * component's own state and dies with the panel that shows it.
 */
export function useCreateRunner(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.createRunner>>, Error, RunnerCreate>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: RunnerCreate) => api.createRunner(body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.runners() })
      void client.invalidateQueries({ queryKey: queryKeys.engines() })
      void client.invalidateQueries({ queryKey: queryKeys.queue() })
      options?.onSuccess?.(...args)
    },
  })
}

/** A rename or a resize touches nothing but the runner rows. */
export function useUpdateRunner(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.updateRunner>>,
    Error,
    { id: number; body: RunnerUpdate }
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RunnerUpdate }) => api.updateRunner(id, body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.runners() })
      options?.onSuccess?.(...args)
    },
  })
}

/** A revoke takes the runner's engine rows with it, and hands its work back to the queue. */
export function useDeleteRunner(options?: UseMutationOptions<void, Error, number>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteRunner(id),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.runners() })
      void client.invalidateQueries({ queryKey: queryKeys.engines() })
      void client.invalidateQueries({ queryKey: queryKeys.queue() })
      options?.onSuccess?.(...args)
    },
  })
}

// --- notes ----------------------------------------------------------------

export function useNotes(
  query: api.NoteQuery = {},
  options?: Options<Awaited<ReturnType<typeof api.searchNotes>>>,
) {
  return useQuery({
    queryKey: queryKeys.noteList(query),
    queryFn: () => api.searchNotes(query),
    ...options,
  })
}

export function useNoteTags(options?: Options<Awaited<ReturnType<typeof api.listTags>>>) {
  return useQuery({ queryKey: queryKeys.noteTags(), queryFn: api.listTags, ...options })
}

export function useSaveNote(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.saveNote>>, Error, NoteCreate>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: NoteCreate) => api.saveNote(body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.notes() })
      options?.onSuccess?.(...args)
    },
  })
}

export function useUpdateNote(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.updateNote>>,
    Error,
    { id: number; body: NoteUpdate }
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: NoteUpdate }) => api.updateNote(id, body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.notes() })
      options?.onSuccess?.(...args)
    },
  })
}

// --- live -----------------------------------------------------------------

/**
 * The live session as the server holds it. The socket writes `live.updated` payloads
 * straight into this key, so the fetch happens once on load and once per reconnect.
 */
export function useLiveState(options?: Options<Awaited<ReturnType<typeof api.getLiveState>>>) {
  return useQuery({ queryKey: queryKeys.live(), queryFn: api.getLiveState, ...options })
}

// --- meta -----------------------------------------------------------------

export function useHealth(options?: Options<Awaited<ReturnType<typeof api.health>>>) {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: api.health,
    refetchInterval: 30_000,
    retry: false,
    ...options,
  })
}
