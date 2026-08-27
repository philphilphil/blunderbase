import { isSessionLoss, reportSessionLost } from '@/lib/auth/session'

import type { ErrorBody } from './types'

/**
 * Where the backend lives, from the browser's point of view.
 *
 * The FastAPI routers are mounted at bare paths, so the dev server proxies `/api/*` to
 * `http://127.0.0.1:8765/*` (see vite.config.ts). `VITE_API_BASE` overrides it for a
 * build that talks to the backend directly.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '')

/** The `/events` WebSocket, absolute, derived from wherever the page is served from. */
export function eventsUrl(): string {
  const configured = import.meta.env.VITE_EVENTS_URL
  if (configured) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/events`
}

/** A non-2xx response, carrying the backend's stable `error` name (see api/errors.py). */
export class ApiError extends Error {
  readonly status: number
  readonly error: string
  readonly fields?: { field: string; message: string }[]

  constructor(status: number, body: ErrorBody) {
    super(body.detail || body.error)
    this.name = 'ApiError'
    this.status = status
    this.error = body.error
    this.fields = body.fields
  }
}

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number)[]

/** Query params, skipping anything unset. Arrays repeat the key, the way FastAPI reads them. */
export function toQuery(params: Record<string, QueryValue> | undefined): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
    } else {
      search.append(key, String(value))
    }
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Record<string, QueryValue>
  /** Sent as JSON. */
  body?: unknown
  /** Sent verbatim as `text/plain` — the PGN upload endpoint takes the file as the body. */
  text?: string
  signal?: AbortSignal
}

async function readError(response: Response): Promise<ApiError> {
  let body: ErrorBody = { error: 'http_error', detail: response.statusText }
  try {
    const parsed: unknown = await response.json()
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      body = parsed as ErrorBody
    }
  } catch {
    // A proxy or a crash can answer with something that is not our error shape.
  }
  return new ApiError(response.status, body)
}

/**
 * One request against the backend. Throws `ApiError` on any non-2xx, returns `undefined`
 * for a 204 (the DELETE routes) and the parsed JSON otherwise.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, text, signal } = options
  const headers: Record<string, string> = { accept: 'application/json' }
  let payload: BodyInit | undefined

  if (text !== undefined) {
    headers['content-type'] = 'text/plain; charset=utf-8'
    payload = text
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE}${path}${toQuery(query)}`, {
    method,
    headers,
    body: payload,
    signal,
  })

  if (!response.ok) {
    const failure = await readError(response)
    // A guarded route saying `unauthorized` or `setup_required` is the whole app's
    // problem, not this caller's: the session ended, so the page has to go back to the
    // login (or setup) screen. The error is still thrown — nothing is retried here, and
    // the caller renders whatever it renders for a failure until the gate swaps it out.
    if (failure.status === 401 && isSessionLoss(failure.error)) {
      reportSessionLost(failure.error)
    }
    throw failure
  }
  if (response.status === 204) return undefined as T
  const raw = await response.text()
  return (raw ? JSON.parse(raw) : undefined) as T
}

export const http = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body' | 'text'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'POST' }),
  patch: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'PATCH' }),
  put: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'PUT' }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
}
