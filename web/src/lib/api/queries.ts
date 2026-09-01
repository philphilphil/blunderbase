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
import { useEffect, useState } from 'react'

import { ApiError, type Download } from './client'
import * as api from './endpoints'
import { queryKeys } from './keys'
import { DEFAULT_MAIA_TARGET_ELO, SERVER_CAPABILITIES } from './types'
import type {
  AnalysisRequest,
  AppSettings,
  AppSettingsUpdate,
  AuthStatus,
  BatchAnalysisRequest,
  EngineCreate,
  EngineDeleteResult,
  EngineRolesUpdate,
  EngineUpdate,
  GameFilters,
  GamesDeleted,
  DeletionsForgotten,
  GamesRemoved,
  ImportRequest,
  LineCreate,
  McpKeyCreate,
  NoteCreate,
  NoteExportFormat,
  NoteResponse,
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

/**
 * Every level this deployment asks Maia at, off the bootstrap payload every screen already
 * has — lowest first, and never empty once it has landed.
 *
 * `useAuthStatus` here subscribes to the query `AuthProvider` mounted rather than issuing a
 * second one. `null` is the payload not having arrived yet, never a deployment without
 * levels: there are always levels. A deployment that predates the list (or a status this
 * client made up for itself, signed out) is read as the single level it does name.
 */
export function useMaiaElos(): number[] | null {
  const { data } = useAuthStatus()
  if (!data) return null
  const elos = data.maia_elos
  if (Array.isArray(elos) && elos.length > 0) return elos
  return typeof data.maia_target_elo === 'number' ? [data.maia_target_elo] : null
}

/**
 * The first of `useMaiaElos` — kept for the screens that show a single level, and for the
 * one place a level has to be named without a choice.
 */
export function useMaiaTargetElo(): number | null {
  return useMaiaElos()?.[0] ?? null
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
  // The level survives the sign-out: it is the deployment's, not the session's, and the
  // login screen has no way to ask for it again.
  const signedOut = () =>
    client.setQueryData<AuthStatus>(queryKeys.auth(), (previous) => ({
      setup_required: false,
      authenticated: false,
      capabilities: previous?.capabilities ?? SERVER_CAPABILITIES,
      maia_target_elo: previous?.maia_target_elo ?? DEFAULT_MAIA_TARGET_ELO,
    }))
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

// --- settings --------------------------------------------------------------

/** What the analysis configuration pages render from. */
export function useAppSettings(options?: Options<Awaited<ReturnType<typeof api.getAppSettings>>>) {
  return useQuery({ queryKey: queryKeys.settings(), queryFn: api.getAppSettings, ...options })
}

/**
 * Save the settings, and make every screen that was rendered against the old ones catch up.
 *
 * The Maia levels are not only this page's: they ride on the bootstrap payload
 * (`useMaiaElos`) and they are the levels the analysis board asks its live questions at.
 * So the write invalidates `auth` and `maia` as well as its own key — and `analysis` whole,
 * because the coverage answer's Maia block is a reading *of* the levels that were just
 * changed: which of them the library carries, how many games are missing one, and what a
 * fill would therefore cost. The game page and the Analysis page both catch up without a
 * reload.
 */
export function useSaveAppSettings(
  options?: UseMutationOptions<AppSettings, Error, AppSettingsUpdate>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: AppSettingsUpdate) => api.saveAppSettings(body),
    ...options,
    onSuccess: (...args) => {
      client.setQueryData(queryKeys.settings(), args[0])
      void client.invalidateQueries({ queryKey: queryKeys.auth() })
      void client.invalidateQueries({ queryKey: queryKeys.maia() })
      void client.invalidateQueries({ queryKey: queryKeys.analysis() })
      options?.onSuccess?.(...args)
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

/** The complete portable game library as a single PGN document. */
export function useExportLibrary(options?: UseMutationOptions<Download, Error, void>) {
  return useMutation({ mutationFn: () => api.exportLibrary(), ...options })
}

/** Cheap estimate for setting expectations before the native browser download begins. */
export function useBackupEstimate() {
  return useQuery({ queryKey: queryKeys.backupEstimate(), queryFn: api.getBackupEstimate })
}

/** Prepare the verified file; its receipt is then handed to a native browser download. */
export function usePrepareBackup(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.prepareBackup>>, Error, void>,
) {
  return useMutation({ mutationFn: () => api.prepareBackup(), ...options })
}

/**
 * Empty the library after the confirmation appropriate to this runtime.
 *
 * The invalidation is deliberately whole prefixes rather than the keys this page happens
 * to hold: every screen the app has ever rendered was rendered against games that no
 * longer exist. Stats and the profile, the queue and the runs, the explorer tree, the
 * sync history and the notes list all go back to the server — what comes back is empty,
 * which is the point.
 */
export function useDeleteAllGames(
  options?: UseMutationOptions<GamesDeleted, Error, string | undefined>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (password: string | undefined) => api.deleteAllGames(password),
    ...options,
    onSuccess: (...args) => {
      for (const queryKey of [
        queryKeys.games(),
        queryKeys.stats(),
        queryKeys.analysis(),
        queryKeys.imports(),
        queryKeys.explorer(),
        queryKeys.notes(),
      ]) {
        void client.invalidateQueries({ queryKey })
      }
      options?.onSuccess?.(...args)
    },
  })
}

/** The games an import is refusing to store again, for the Manage screen's list. */
export function useDeletedGames(query: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: queryKeys.deletedGames(query),
    queryFn: () => api.listDeletedGames(query),
  })
}

/**
 * Forget some deletions, or all of them when called with nothing.
 *
 * Only the list itself is invalidated: forgetting brings no game back, so no games query,
 * no stat and no explorer row moved. What changed is what the *next* import will do.
 */
export function useForgetDeletions(
  options?: UseMutationOptions<DeletionsForgotten, Error, number[] | undefined>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids?: number[]) => api.forgetDeletions(ids),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.library() })
      options?.onSuccess?.(...args)
    },
  })
}

/**
 * Delete one game or a selection of them.
 *
 * The invalidation is narrower than the wipe's but the same idea: everything that counted
 * these games has to count again. `['import']` is not in it — the sync history survives a
 * delete, so no job row moved.
 */
export function useDeleteGames(
  options?: UseMutationOptions<GamesRemoved, Error, number[]>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (gameIds: number[]) => api.deleteGames(gameIds),
    ...options,
    onSuccess: (...args) => {
      for (const queryKey of [
        queryKeys.games(),
        queryKeys.stats(),
        queryKeys.analysis(),
        queryKeys.explorer(),
        queryKeys.notes(),
        queryKeys.lines(),
        // Every deleted game is written into the record the Manage screen lists.
        queryKeys.library(),
      ]) {
        void client.invalidateQueries({ queryKey })
      }
      options?.onSuccess?.(...args)
    },
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

/**
 * The whole library's analysis state — the Analysis page's single read.
 *
 * Under `['analysis']`, so the existing socket invalidation carries it: a run finishing
 * moves the coverage split, the backlog counts and the estimates at once, and this is one
 * request rather than the six the page would otherwise assemble a contradiction from.
 */
export function useCoverage(options?: Options<Awaited<ReturnType<typeof api.getCoverage>>>) {
  return useQuery({ queryKey: queryKeys.coverage(), queryFn: api.getCoverage, ...options })
}

/**
 * The failed runs, newest first — the listing that did not exist, so a failure was
 * invisible once the socket frames announcing it had passed.
 */
export function useFailedRuns(
  limit = FAILED_RUN_LIMIT,
  options?: Options<Awaited<ReturnType<typeof api.listRuns>>>,
) {
  return useQuery({
    queryKey: queryKeys.failedRuns(limit),
    queryFn: () => api.listRuns(undefined, undefined, { status: 'failed', limit }),
    ...options,
  })
}

/** A screenful of failures. The count beside them comes from `/analysis/coverage`. */
export const FAILED_RUN_LIMIT = 50

/**
 * Pick the failures back up. Invalidates `['analysis']` whole: the retry queues runs, so
 * the queue, the coverage split and the failed listing all moved at once.
 *
 * A 409 `tier_unavailable` is the expected refusal, not a bug — the tier behind the
 * failures still has no engine — and the caller is the one that can say so in words.
 */
export function useRetryFailed(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.retryFailedRuns>>,
    Error,
    number[] | undefined
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (runIds: number[] | undefined) => api.retryFailedRuns(runIds),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.analysis() })
      options?.onSuccess?.(...args)
    },
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

/** A selection's worth of games, queued in one call. Partly refused is still a success. */
export function useRequestAnalysisBatch(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.requestAnalysisBatch>>,
    Error,
    BatchAnalysisRequest
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: BatchAnalysisRequest) => api.requestAnalysisBatch(body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.analysis() })
      options?.onSuccess?.(...args)
    },
  })
}

/**
 * How many games a whole-library pass of this tier would take on — the number the Analysis
 * page's backfill cards are labelled with.
 *
 * The key lives under `['analysis']`, so every analysis event marks it stale, which is
 * what keeps those labels honest as games trickle in. That includes the pass the buttons
 * themselves started: the page stays mounted while a backfill drains, so the count comes
 * back down and the buttons relabel themselves as it goes, which is the point. The
 * `['analysis']` cooldown is what keeps that cheap under the burst.
 */
export function useBackfillPreview(
  tier: Tier,
  options?: Options<Awaited<ReturnType<typeof api.getBackfill>>>,
) {
  return useQuery({
    queryKey: queryKeys.backfill(tier),
    queryFn: () => api.getBackfill(tier),
    ...options,
  })
}

/**
 * The whole library, queued in one call. The answer is counts rather than runs — the
 * backend deliberately sends one `analysis.backfill` frame instead of one per game — so
 * the queue is what the caller watches from here.
 */
export function useStartBackfill(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.startBackfill>>, Error, Tier>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (tier: Tier) => api.startBackfill(tier),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.analysis() })
      options?.onSuccess?.(...args)
    },
  })
}

/**
 * The undo for a queue built up by mistake: every tier, windowed or full-game, fill or
 * not. What an engine already has claimed is left to finish — see `api.clearQueue`.
 */
export function useClearQueue(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.clearQueue>>, Error, void>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => api.clearQueue(),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.analysis() })
      options?.onSuccess?.(...args)
    },
  })
}

/**
 * The queue's stop and start. One mutation for both directions, because the button is one
 * switch: what it posts is decided by the state it is in, not by which hook was called.
 */
export function useSetQueuePaused(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.pauseQueue>>, Error, boolean>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (paused: boolean) => (paused ? api.pauseQueue() : api.resumeQueue()),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.analysis() })
      options?.onSuccess?.(...args)
    },
  })
}

// --- import ---------------------------------------------------------------

export function useImportJobs(
  query: { source?: Source; limit?: number; offset?: number } = {},
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
    { pgn: string; wait?: boolean; max_games?: number; analyze?: boolean }
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({
      pgn,
      ...query
    }: {
      pgn: string
      wait?: boolean
      max_games?: number
      analyze?: boolean
    }) => api.uploadPgn(pgn, query),
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

/**
 * The book for a position the shipped payload does not carry — see `api.getPositionBook`.
 *
 * `enabled` is the caller's, and the caller only turns it on once the board has left the
 * game line: on the game's own plies the answer is already in hand, and asking per ply as
 * somebody holds an arrow key down is the shape that took the server down once before.
 */
export function usePositionBook(
  fen: string | null,
  options?: Options<Awaited<ReturnType<typeof api.getPositionBook>>>,
) {
  return useQuery({
    queryKey: queryKeys.explorerBook(fen ?? ''),
    queryFn: () => api.getPositionBook(fen!),
    enabled: fen !== null,
    // A position's history does not change while the page is open.
    staleTime: Infinity,
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

export function useStatsDashboard(
  query: api.StatsDashboardQuery = {},
  options?: Options<Awaited<ReturnType<typeof api.getStatsDashboard>>>,
) {
  return useQuery({
    queryKey: queryKeys.statsDashboard(query),
    queryFn: () => api.getStatsDashboard(query),
    ...options,
  })
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

/**
 * What runs what: the engine assigned to each role, and whether it can run. `['engines']` is
 * a prefix of this key, so a runner connecting — which flips `enabled` on its rows and with
 * it whether an assigned engine is available — already invalidates it.
 */
export function useEngineRoles(options?: Options<Awaited<ReturnType<typeof api.listEngineRoles>>>) {
  return useQuery({ queryKey: queryKeys.engineRoles(), queryFn: api.listEngineRoles, ...options })
}

/**
 * Assign engines to roles. Only the keys sent are written; `null` empties a role.
 *
 * The PUT answers with the whole assignment, so it is written into the roles cache directly
 * rather than only invalidated: the select the owner just changed would otherwise snap back
 * to the stored value until the refetch landed, which reads as a save that did not take. The
 * `['engines']` invalidation on top of that is for everything else that names a role — the
 * roster's badges and the detail card.
 */
export function useSetEngineRoles(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.setEngineRoles>>,
    Error,
    EngineRolesUpdate
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: EngineRolesUpdate) => api.setEngineRoles(body),
    ...options,
    onSuccess: (...args) => {
      client.setQueryData(queryKeys.engineRoles(), args[0])
      void client.invalidateQueries({ queryKey: queryKeys.engines() })
      options?.onSuccess?.(...args)
    },
  })
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

// --- mcp keys -------------------------------------------------------------

export function useMcpKeys(options?: Options<Awaited<ReturnType<typeof api.listMcpKeys>>>) {
  return useQuery({ queryKey: queryKeys.mcpKeys(), queryFn: api.listMcpKeys, ...options })
}

/**
 * Minting a key returns its token once. As with runners the answer is *not* written into
 * the cache: the token lives in the component's own state and dies with the panel.
 */
export function useCreateMcpKey(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.createMcpKey>>, Error, McpKeyCreate>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: McpKeyCreate) => api.createMcpKey(body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.mcpKeys() })
      options?.onSuccess?.(...args)
    },
  })
}

/** A revoke stops the token dead; a client still holding it is refused from the next call. */
export function useDeleteMcpKey(options?: UseMutationOptions<void, Error, number>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteMcpKey(id),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.mcpKeys() })
      options?.onSuccess?.(...args)
    },
  })
}

// --- search ---------------------------------------------------------------

/** Under this the backend answers four empty groups, so there is nothing to ask for. */
const SEARCH_MIN = 2
/** Long enough that a fast typist makes one request per word, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 150

/** `q` as it was a beat ago — one render behind the keystroke, so the key settles. */
function useDebounced(value: string, delay = SEARCH_DEBOUNCE_MS): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}

/**
 * The command palette's four groups, debounced.
 *
 * The debounce lives here rather than at the call site because it is part of what the
 * query *is*: the box is typed into, and every intermediate spelling is a key nobody
 * wants cached. A query too short to answer is never sent — `enabled` holds it — and the
 * previous answer stays on screen while the next one is in flight, so the list does not
 * blank between keystrokes.
 */
export function useSearch(
  q: string,
  limit = 5,
  options?: Options<Awaited<ReturnType<typeof api.search>>>,
) {
  const settled = useDebounced(q).trim()
  return useQuery({
    queryKey: queryKeys.search(settled, limit),
    queryFn: () => api.search(settled, limit),
    enabled: settled.length >= SEARCH_MIN,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    ...options,
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

/** One note by id — what `/notes?note=12` from the command palette lands on. */
export function useNote(id: number, options?: Options<Awaited<ReturnType<typeof api.getNote>>>) {
  return useQuery({
    queryKey: queryKeys.note(id),
    queryFn: () => api.getNote(id),
    ...options,
  })
}

export function useNoteTags(options?: Options<Awaited<ReturnType<typeof api.listTags>>>) {
  return useQuery({ queryKey: queryKeys.noteTags(), queryFn: api.listTags, ...options })
}

/**
 * Write a note. What it touches depends on what it landed on, which the answer names: a
 * note on a game rides in that game's detail payload, and a note that pinned a variation
 * has just created a line the game page renders.
 */
export function useSaveNote(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.saveNote>>, Error, NoteCreate>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: NoteCreate) => api.saveNote(body),
    ...options,
    onSuccess: (...args) => {
      noteWritten(client, args[0])
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
      noteWritten(client, args[0])
      options?.onSuccess?.(...args)
    },
  })
}

/**
 * Forget a note. The answer is a 204, so nothing here knows what the note hung on: every
 * game detail, every line list and the explorer's trees go back to the server rather than
 * the one that held it.
 */
export function useDeleteNote(options?: UseMutationOptions<void, Error, number>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteNote(id),
    ...options,
    onSuccess: (...args) => {
      for (const queryKey of [
        queryKeys.notes(),
        queryKeys.lines(),
        queryKeys.gameDetails(),
        queryKeys.explorer(),
      ]) {
        void client.invalidateQueries({ queryKey })
      }
      options?.onSuccess?.(...args)
    },
  })
}

/**
 * The filtered notes as a document — Markdown or PGN. A mutation rather than a query
 * because it is an action with no cached answer; hand the result to `saveDownload`.
 */
export function useExportNotes(
  options?: UseMutationOptions<
    Download,
    Error,
    { format?: NoteExportFormat; query?: api.NoteExportQuery }
  >,
) {
  return useMutation({
    mutationFn: ({
      format = 'md',
      query = {},
    }: {
      format?: NoteExportFormat
      query?: api.NoteExportQuery
    }) => api.exportNotes(format, query),
    ...options,
  })
}

/**
 * What one note write makes stale: the notes, the explorer, its game's detail, and any line
 * it pinned.
 *
 * The explorer always, and whatever the note landed on: its move rows carry the newest note
 * on the position each move leads to, so a note written anywhere can have changed one of
 * them, and the tree would otherwise keep showing the note it was fetched with.
 */
function noteWritten(client: ReturnType<typeof useQueryClient>, note: NoteResponse): void {
  const keys = [queryKeys.notes(), queryKeys.explorer()]
  if (typeof note.line_id === 'number') keys.push(queryKeys.lines())
  if (typeof note.game_id === 'number') keys.push(queryKeys.gameDetail(note.game_id))
  for (const queryKey of keys) void client.invalidateQueries({ queryKey })
}

// --- lines ----------------------------------------------------------------

/** The variations kept on a game, each with its notes. */
export function useGameLines(
  gameId: number,
  options?: Options<Awaited<ReturnType<typeof api.listLines>>>,
) {
  return useQuery({
    queryKey: queryKeys.gameLines(gameId),
    queryFn: () => api.listLines(gameId),
    ...options,
  })
}

/**
 * Pin a variation. The answer is the row that now holds it, which may be one that was
 * already there (a prefix) or one just extended — so the caller reads the id off the
 * answer rather than assuming a new line.
 */
export function useSaveLine(
  options?: UseMutationOptions<Awaited<ReturnType<typeof api.saveLine>>, Error, LineCreate>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: LineCreate) => api.saveLine(body),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.lines() })
      void client.invalidateQueries({ queryKey: queryKeys.gameDetail(args[0].game_id) })
      options?.onSuccess?.(...args)
    },
  })
}

/**
 * Unpin a variation. Its notes survive with their `line_id` cleared, so the notes move
 * too — a note that was a line note is a game note afterwards.
 */
export function useDeleteLine(
  options?: UseMutationOptions<void, Error, { id: number; gameId?: number }>,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: number; gameId?: number }) => api.deleteLine(id),
    ...options,
    onSuccess: (...args) => {
      const gameId = args[1].gameId
      void client.invalidateQueries({ queryKey: queryKeys.lines() })
      void client.invalidateQueries({ queryKey: queryKeys.notes() })
      void client.invalidateQueries({
        queryKey: typeof gameId === 'number' ? queryKeys.gameDetail(gameId) : queryKeys.gameDetails(),
      })
      options?.onSuccess?.(...args)
    },
  })
}

// --- maia -----------------------------------------------------------------

export interface MaiaPolicyQuery {
  /** Null keeps the query shut — nothing is asked about "no position". */
  fen: string | null
  /** One level. The single-level spelling of `elos`, kept because callers still use it. */
  elo?: number | null
  /** Every level wanted, in one call. Null or empty asks the deployment's configured ones. */
  elos?: number[] | null
  moves?: number
  rolloutPlies?: number
}

/**
 * The human model on the position the analysis board is standing on — every level asked
 * for in one request.
 *
 * A position never changes its answer, so the result is cached forever under its FEN and
 * levels: stepping back into a line the reader has already walked costs no round trip.
 * Several levels are one query rather than one per level because they are one call on the
 * backend — a single warm process under a single lock — and because a comparison whose
 * columns arrive one at a time reads as five loading panels.
 *
 * Nothing is retried: a `409` (no local Maia) is a standing fact about the deployment, not
 * a blip, and the panel hides itself on it.
 */
export function useMaiaPolicy(
  { fen, elo = null, elos = null, moves, rolloutPlies = 0 }: MaiaPolicyQuery,
  options?: Options<Awaited<ReturnType<typeof api.maiaPolicy>>>,
) {
  // Sorted and deduped here rather than at the call site, so that two callers asking for
  // the same levels in a different order share one cache entry and one request.
  const wanted = levelsAsked(elos, elo)
  // One level goes on the wire as `elo` rather than as a list of one: it is the request
  // this endpoint has always answered, and it keeps a single-level board's traffic
  // byte-for-byte what it was.
  const single = wanted?.length === 1 ? wanted[0] : undefined
  return useQuery({
    queryKey: queryKeys.maiaPolicy(fen ?? '', wanted, rolloutPlies),
    queryFn: () =>
      api.maiaPolicy({
        fen: fen ?? '',
        elo: single,
        elos: single === undefined ? (wanted ?? undefined) : undefined,
        moves,
        rollout_plies: rolloutPlies || undefined,
      }),
    enabled: fen !== null,
    retry: false,
    staleTime: Infinity,
    ...options,
  })
}

/** The levels a query is about: `elos` if it named any, else `elo`, else the configured ones. */
function levelsAsked(elos: number[] | null | undefined, elo: number | null): number[] | null {
  if (elos && elos.length > 0) return [...new Set(elos)].sort((left, right) => left - right)
  return elo === null ? null : [elo]
}

/**
 * How many analysed games are missing one of the configured levels — the number the fill
 * button labels itself with.
 *
 * Under `['analysis']`, so it catches up on its own as the fill's runs come back.
 */
export function useMaiaFillStatus(
  options?: Options<Awaited<ReturnType<typeof api.getMaiaFillStatus>>>,
) {
  return useQuery({
    queryKey: queryKeys.maiaFill(),
    queryFn: api.getMaiaFillStatus,
    ...options,
  })
}

/**
 * Queue the missing Maia levels over the library (or over the games named).
 *
 * The answer is counts rather than runs, so the queue is what the caller watches from
 * here — and pressing twice queues the work once, because a fill already in flight counts
 * as complete.
 */
export function useMaiaFill(
  options?: UseMutationOptions<
    Awaited<ReturnType<typeof api.maiaFill>>,
    Error,
    number[] | undefined
  >,
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (gameIds?: number[]) => api.maiaFill(gameIds),
    ...options,
    onSuccess: (...args) => {
      void client.invalidateQueries({ queryKey: queryKeys.analysis() })
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
