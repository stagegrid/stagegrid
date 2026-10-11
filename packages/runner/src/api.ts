import type { ClaimedRunDto, QueuedRunDto, RunnerDto, UsageWindow } from '@stagegrid/shared'

import type { SubmissionPayload } from './delivery'

export class RunnerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'RunnerApiError'
  }

  /** The server says this lease is gone (cancelled, replaced or timed out): stop working on the run. */
  get isStaleLease(): boolean {
    return (
      this.status === 409 &&
      (this.details as { code?: string } | undefined)?.code === 'stale_fencing'
    )
  }

  get isNetwork(): boolean {
    return this.status === 0
  }
}

export interface RunEventBody {
  eventId: string
  sequence: number
  type: 'progress' | 'log' | 'session' | 'capacity_wait'
  payload: Record<string, unknown>
  fencingToken: number
}

export interface AskBody {
  questions: { prompt: string; options: string[] }[]
  contextRevisionId: string
  idempotencyKey: string
  fencingToken: number
}

export interface CompleteBody {
  fencingToken: number
  idempotencyKey: string
  outcome: 'succeeded' | 'failed' | 'interrupted'
  summary?: string
  failureReason?: string
  submission?: SubmissionPayload
}

export interface CapacityBody {
  provider: string
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
}

type FetchFn = typeof fetch

async function call<T>(
  fetchFn: FetchFn,
  url: string,
  init: { method: string; credential?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  let res: Response
  try {
    res = await fetchFn(url, {
      method: init.method,
      headers: {
        ...(init.credential ? { authorization: `Bearer ${init.credential}` } : {}),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    })
  } catch (e) {
    if (init.signal?.aborted) throw e
    throw new RunnerApiError(
      0,
      'network',
      `Couldn't reach Stagegrid at ${url}: ${(e as Error).message}`,
    )
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : undefined
  if (!res.ok) {
    const err = (
      data as { error?: { code?: string; message?: string; details?: unknown } } | undefined
    )?.error
    throw new RunnerApiError(
      res.status,
      err?.code ?? 'internal',
      err?.message ?? `Stagegrid answered ${res.status}`,
      err?.details,
    )
  }
  return data as T
}

/** The runner's whole view of the server: queue, claim, heartbeat, events, completion, capacity. */
export class RunnerApi {
  private readonly base: string

  constructor(
    baseUrl: string,
    private readonly credential: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.base = `${baseUrl.replace(/\/+$/, '')}/api/v1/runner`
  }

  static enroll(
    baseUrl: string,
    input: { token: string; providers: string[]; version?: string },
    fetchFn: FetchFn = fetch,
  ): Promise<{ credential: string; runner: RunnerDto }> {
    return call(fetchFn, `${baseUrl.replace(/\/+$/, '')}/api/v1/runner/enroll`, {
      method: 'POST',
      body: input,
    })
  }

  private request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal) {
    return call<T>(this.fetchFn, `${this.base}${path}`, {
      method,
      credential: this.credential,
      body,
      signal,
    })
  }

  setSelf(input: { providers: string[]; version?: string }): Promise<void> {
    return this.request('PUT', '/self', input)
  }
  reportCapacity(input: CapacityBody): Promise<void> {
    return this.request('PUT', '/capacity', input)
  }
  queue(waitSeconds: number, signal?: AbortSignal): Promise<QueuedRunDto[]> {
    return this.request('GET', `/queue?wait=${waitSeconds}`, undefined, signal)
  }
  claim(runId: string, idempotencyKey: string): Promise<ClaimedRunDto> {
    return this.request('POST', `/runs/${runId}/claim`, { idempotencyKey })
  }
  heartbeat(runId: string, fencingToken: number): Promise<{ leaseExpiresAt: string }> {
    return this.request('POST', `/runs/${runId}/heartbeat`, { fencingToken })
  }
  event(runId: string, body: RunEventBody): Promise<{ duplicate: boolean }> {
    return this.request('POST', `/runs/${runId}/events`, body)
  }
  ask(runId: string, body: AskBody): Promise<unknown> {
    return this.request('POST', `/runs/${runId}/questions`, body)
  }
  complete(runId: string, body: CompleteBody): Promise<unknown> {
    return this.request('POST', `/runs/${runId}/complete`, body)
  }
}
