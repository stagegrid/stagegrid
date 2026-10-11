import { describe, expect, it } from 'vitest'

import { RunnerApi, RunnerApiError } from '../src/api'

function fakeFetch(
  respond: (url: string, init: RequestInit) => { status: number; body?: unknown },
): { fn: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const r = respond(url, init)
    return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), {
      status: r.status,
    })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('RunnerApi', () => {
  it('sends the credential as a bearer token to the runner endpoints', async () => {
    const f = fakeFetch(() => ({ status: 200, body: [] }))
    await new RunnerApi('https://sg.example.com/', 'sg_runner_abc', f.fn).queue(20)
    expect(f.calls[0]!.url).toBe('https://sg.example.com/api/v1/runner/queue?wait=20')
    expect(new Headers(f.calls[0]!.init.headers).get('authorization')).toBe('Bearer sg_runner_abc')
  })

  it('posts claims, events and completions with their bodies', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { duplicate: false } }))
    const api = new RunnerApi('https://sg.example.com', 'c', f.fn)
    await api.claim('run-1', 'key-1')
    await api.event('run-1', {
      eventId: 'e1',
      sequence: 1,
      type: 'progress',
      payload: {},
      fencingToken: 3,
    })
    await api.complete('run-1', {
      fencingToken: 3,
      idempotencyKey: 'k',
      outcome: 'succeeded',
    })
    expect(f.calls.map((c) => c.url)).toEqual([
      'https://sg.example.com/api/v1/runner/runs/run-1/claim',
      'https://sg.example.com/api/v1/runner/runs/run-1/events',
      'https://sg.example.com/api/v1/runner/runs/run-1/complete',
    ])
    expect(JSON.parse(f.calls[0]!.init.body as string)).toEqual({ idempotencyKey: 'key-1' })
  })

  it('enrols without a credential', async () => {
    const f = fakeFetch(() => ({ status: 201, body: { credential: 'sg_runner_x', runner: {} } }))
    const r = await RunnerApi.enroll(
      'https://sg.example.com',
      { token: 't', providers: ['codex'] },
      f.fn,
    )
    expect(r.credential).toBe('sg_runner_x')
    expect(new Headers(f.calls[0]!.init.headers).get('authorization')).toBeNull()
  })

  it('turns server errors into typed errors, and spots a revoked lease', async () => {
    const f = fakeFetch(() => ({
      status: 409,
      body: { error: { code: 'conflict', message: 'Stop', details: { code: 'stale_fencing' } } },
    }))
    const err = await new RunnerApi('https://x', 'c', f.fn).heartbeat('r', 1).catch((e) => e)
    expect(err).toBeInstanceOf(RunnerApiError)
    expect(err).toMatchObject({
      status: 409,
      code: 'conflict',
      isStaleLease: true,
      isNetwork: false,
    })
  })

  it('reports a network failure as such', async () => {
    const fn = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const err = await new RunnerApi('https://x', 'c', fn).queue(0).catch((e) => e)
    expect(err).toMatchObject({ isNetwork: true, status: 0 })
  })
})
