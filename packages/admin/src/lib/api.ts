import type { ApiErrorBody, ErrorCode } from '@stagegrid/shared'

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode | 'network'
  readonly details?: unknown

  constructor(status: number, code: ErrorCode | 'network', message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type Json = Record<string, unknown> | unknown[]

/**
 * Calls the Stagegrid API (`/api/v1` + path) with the session cookie. JSON in, JSON out;
 * non-2xx answers throw ApiError carrying the server's error code and message.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: Json; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })
  } catch {
    throw new ApiError(0, 'network', "Couldn't reach the server. Check your connection.")
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error
    throw new ApiError(
      res.status,
      err?.code ?? 'internal',
      err?.message ?? 'Something went wrong',
      err?.details,
    )
  }
  return data as T
}

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : 'Something went wrong'
