import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClaimedRunDto, QueuedRunDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import type { AdapterInput, AdapterOutcome, AgentAdapter } from '../src/adapters/types'
import { type CompleteBody, type RunEventBody, RunnerApiError } from '../src/api'
import { configSchema } from '../src/config'
import { type LoopApi, RunnerLoop } from '../src/loop'

class FakeApi implements LoopApi {
  queued: QueuedRunDto[] = []
  claims = new Map<string, ClaimedRunDto>()
  claimError: RunnerApiError | null = null
  heartbeatError: RunnerApiError | null = null
  events: RunEventBody[] = []
  completions: CompleteBody[] = []
  capacity: unknown[] = []
  heartbeats = 0

  async queue() {
    const q = this.queued
    this.queued = []
    return q
  }
  async claim(runId: string) {
    if (this.claimError) throw this.claimError
    return this.claims.get(runId)!
  }
  async heartbeat() {
    this.heartbeats += 1
    if (this.heartbeatError) throw this.heartbeatError
    return { leaseExpiresAt: '' }
  }
  async event(_: string, body: RunEventBody) {
    this.events.push(body)
    return { duplicate: false }
  }
  async complete(_: string, body: CompleteBody) {
    this.completions.push(body)
    return {}
  }
  async reportCapacity(input: unknown) {
    this.capacity.push(input)
  }
}

const stale = new RunnerApiError(409, 'conflict', 'Stop', { code: 'stale_fencing' })

async function repoDir() {
  const dir = await mkdtemp(join(tmpdir(), 'sg-loop-repo-'))
  const run = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  run('init', '-b', 'main')
  run('config', 'user.email', 't@example.com')
  run('config', 'user.name', 'T')
  await writeFile(join(dir, 'a.txt'), 'a\n')
  run('add', '.')
  run('commit', '-m', 'init')
  return dir
}

function claimFor(id: string, extra: Partial<ClaimedRunDto['run']> = {}): ClaimedRunDto {
  return {
    run: {
      id,
      attempt: 1,
      fencingToken: 4,
      leaseExpiresAt: '2026-10-20T03:01:30.000Z',
      sessionRef: null,
      runtime: { provider: 'claude_code', model: 'sonnet', instructions: 'Tests first.' },
      ...extra,
    },
    project: { id: 'p1', slug: 'pilot', name: 'Pilot' },
    employee: { id: 'e1', displayName: 'Mali', role: 'dev' },
    task: {
      id: '0192f3c4-aaaa-7bbb-8ccc-ddddeeeeffff',
      title: 'Email login',
      scope: 'Sign in',
      acceptanceCriteria: ['Reject a wrong password'],
    },
    context: {
      revisionId: 'r1',
      revisionNo: 1,
      createdAt: '2026-10-20T03:00:00.000Z',
      outdated: [],
      manifestHash: 'h',
      manifest: {
        schemaVersion: 1,
        answers: [],
        documents: [],
        sources: [
          {
            title: 'Mail',
            url: null,
            content: 'No offline mode',
            retrievedAt: '2026-10-20T03:00:00.000Z',
          },
        ],
        decisions: ['Email and password only'],
      },
    },
    documents: [
      {
        documentId: 'd1',
        revisionId: 'dr1',
        version: 2,
        title: 'SRS',
        markdown: '# SRS\nLogin rules',
      },
    ],
  }
}

class FakeAdapter implements AgentAdapter {
  readonly provider = 'claude_code' as const
  inputs: AdapterInput[] = []
  constructor(
    private readonly behave: (
      i: AdapterInput,
      signal: AbortSignal,
      emit: (e: never) => void,
    ) => Promise<AdapterOutcome>,
  ) {}
  async check() {
    return { ok: true, detail: 'fake' }
  }
  run(input: AdapterInput, signal: AbortSignal, onEvent: (e: never) => void) {
    this.inputs.push(input)
    return this.behave(input, signal, onEvent)
  }
}

async function world(adapter: FakeAdapter, opts: { repo?: boolean; max?: number } = {}) {
  const api = new FakeApi()
  const repo = opts.repo === false ? undefined : await repoDir()
  const config = configSchema.parse({
    url: 'https://sg.example.com',
    credential: 'sg_runner_x',
    worktreesDir: await mkdtemp(join(tmpdir(), 'sg-loop-wt-')),
    repos: repo ? { pilot: { path: repo, baseBranch: 'main' } } : {},
    heartbeatSeconds: 5,
  })
  const logs: string[] = []
  const loop = new RunnerLoop({
    api,
    config,
    adapters: [adapter],
    maxConcurrent: opts.max ?? 1,
    log: (m) => logs.push(m),
    progressIntervalMs: 20,
  })
  const enqueue = (id: string, extra: Partial<ClaimedRunDto['run']> = {}) => {
    api.claims.set(id, claimFor(id, extra))
    api.queued.push({
      id,
      projectId: 'p1',
      taskTitle: 'Email login',
      attempt: 1,
      provider: 'claude_code',
    })
  }
  return { api, loop, logs, enqueue }
}

const finished = (extra = {}): AdapterOutcome => ({
  kind: 'finished',
  summary: 'Implemented',
  blocked: false,
  commit: 'abc123',
  tests: '9 passed',
  costUsd: 0.2,
  ...extra,
})

describe('RunnerLoop', () => {
  it('claims a run, works in an isolated worktree with the pinned context, and reports success', async () => {
    const adapter = new FakeAdapter(async (_i, _s, emit) => {
      emit({ type: 'session', sessionRef: 'sess-1' } as never)
      emit({ type: 'progress', message: 'Writing tests' } as never)
      await new Promise((r) => setTimeout(r, 60))
      return finished()
    })
    const { api, loop, enqueue } = await world(adapter)
    enqueue('run-1')
    await loop.tick()
    await loop.idle()

    const input = adapter.inputs[0]!
    expect(input.cwd).toContain('stagegrid-task-0192f3c4-aaa')
    expect(input.prompt).toContain('Reject a wrong password')
    expect(input.prompt).toContain('Email and password only')
    expect(input.prompt).toContain('Login rules')
    expect(input.prompt).toContain('No offline mode')
    expect(input.systemPrompt).toContain('Tests first.')
    expect(input.env.GIT_AUTHOR_NAME).toBe('Mali (AI)')
    expect(input.sessionRef).toBeNull()

    expect(api.events.map((e) => e.type)).toContain('session')
    expect(api.events.find((e) => e.type === 'progress')?.payload).toEqual({
      message: 'Writing tests',
    })
    expect(api.events.map((e) => e.sequence)).toEqual(api.events.map((_, i) => i + 1))
    expect(api.events.every((e) => e.fencingToken === 4)).toBe(true)
    expect(api.completions).toEqual([
      {
        fencingToken: 4,
        idempotencyKey: 'run-1:4:complete',
        outcome: 'succeeded',
        summary: 'Implemented\n\nCommit: abc123\n\nTests: 9 passed',
      },
    ])
    expect(loop.activeRuns).toBe(0)
  })

  it('resumes the same session for a continuation', async () => {
    const adapter = new FakeAdapter(async () => finished())
    const { loop, enqueue } = await world(adapter)
    enqueue('run-2', { sessionRef: 'sess-9' })
    await loop.tick()
    await loop.idle()
    expect(adapter.inputs[0]!.sessionRef).toBe('sess-9')
    expect(adapter.inputs[0]!.prompt).toContain('continuing an earlier session')
  })

  it('reports a blocked agent as a failure with its question, not as success', async () => {
    const adapter = new FakeAdapter(async () =>
      finished({ blocked: true, summary: 'Is lockout required?' }),
    )
    const { api, loop, enqueue } = await world(adapter)
    enqueue('run-3')
    await loop.tick()
    await loop.idle()
    expect(api.completions[0]).toMatchObject({
      outcome: 'failed',
      failureReason: 'Blocked: Is lockout required?',
    })
  })

  it('waits for capacity instead of failing, and does not complete the run', async () => {
    const adapter = new FakeAdapter(async () => ({
      kind: 'capacity',
      resetsAt: '2026-10-20T08:00:00.000Z',
      window: 'fiveHour',
      message: 'Usage limit reached',
    }))
    const { api, loop, enqueue } = await world(adapter)
    enqueue('run-4')
    await loop.tick()
    await loop.idle()
    const wait = api.events.find((e) => e.type === 'capacity_wait')!
    expect(wait.payload).toMatchObject({ resetsAt: '2026-10-20T08:00:00.000Z', window: 'fiveHour' })
    expect(api.completions).toEqual([])
  })

  it('reports interruption and failure from the adapter', async () => {
    for (const [outcome, expected] of [
      [{ kind: 'interrupted', reason: 'Ended early' }, 'interrupted'],
      [{ kind: 'failed', reason: 'Budget' }, 'failed'],
    ] as const) {
      const { api, loop, enqueue } = await world(new FakeAdapter(async () => outcome))
      enqueue('r')
      await loop.tick()
      await loop.idle()
      expect(api.completions[0]).toMatchObject({ outcome: expected, failureReason: outcome.reason })
    }
  })

  const untilAborted =
    (onAbort: () => void) =>
    (_i: AdapterInput, signal: AbortSignal, emit: (e: never) => void): Promise<AdapterOutcome> =>
      new Promise((resolve) => {
        emit({ type: 'session', sessionRef: 's' } as never)
        const stop = () => {
          onAbort()
          resolve({ kind: 'interrupted', reason: 'stopped' })
        }
        if (signal.aborted) stop()
        else signal.addEventListener('abort', stop)
      })

  it('stops and reports nothing when the server refuses an event as stale (cancelled run)', async () => {
    let aborted = false
    const { api, loop, enqueue } = await world(
      new FakeAdapter(untilAborted(() => (aborted = true))),
    )
    api.event = async () => {
      throw stale
    }
    enqueue('run-5')
    await loop.tick()
    await loop.idle()
    expect(aborted).toBe(true)
    expect(api.completions).toEqual([])
  })

  it('stops and reports nothing when a heartbeat says the lease is gone', async () => {
    let aborted = false
    const adapter = new FakeAdapter(untilAborted(() => (aborted = true)))
    const { api, loop, enqueue } = await world(adapter)
    ;(
      loop as unknown as { opts: { config: { heartbeatSeconds: number } } }
    ).opts.config.heartbeatSeconds = 0.03
    api.heartbeatError = stale
    enqueue('run-8')
    await loop.tick()
    await loop.idle()
    expect(aborted).toBe(true)
    expect(api.heartbeats).toBeGreaterThan(0)
    expect(api.completions).toEqual([])
  })

  it('aborts running work on shutdown and still reports it as interrupted', async () => {
    const { api, loop, enqueue } = await world(new FakeAdapter(untilAborted(() => {})))
    enqueue('run-9')
    const controller = new AbortController()
    await loop.tick()
    controller.abort()
    await loop.start(controller.signal)
    expect(api.completions).toEqual([
      expect.objectContaining({ outcome: 'interrupted', failureReason: 'stopped' }),
    ])
  })

  it('fails a run for a project this runner has no repository for', async () => {
    const adapter = new FakeAdapter(async () => finished())
    const { api, loop, enqueue } = await world(adapter, { repo: false })
    enqueue('run-6')
    await loop.tick()
    await loop.idle()
    expect(adapter.inputs).toEqual([])
    expect(api.completions[0]).toMatchObject({ outcome: 'failed' })
    expect(api.completions[0]!.failureReason).toMatch(
      /no repository configured for project "pilot"/,
    )
  })

  it('does not run work it failed to claim, or for a provider it has no adapter for', async () => {
    const adapter = new FakeAdapter(async () => finished())
    const { api, loop, enqueue, logs } = await world(adapter)
    enqueue('lost')
    api.claimError = new RunnerApiError(409, 'conflict', 'Another runner took it', {
      code: 'claim_conflict',
    })
    await loop.tick()
    await loop.idle()
    expect(adapter.inputs).toEqual([])
    expect(logs.join()).toMatch(/not claimed/)
    api.claimError = null
    api.queued.push({ id: 'x', projectId: 'p1', taskTitle: 't', attempt: 1, provider: 'codex' })
    await loop.tick()
    expect(adapter.inputs).toEqual([])
  })

  it('never runs more than its concurrency limit', async () => {
    let running = 0
    let peak = 0
    const adapter = new FakeAdapter(async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 80))
      running -= 1
      return finished()
    })
    const { api, loop, enqueue } = await world(adapter, { max: 1 })
    enqueue('a')
    enqueue('b')
    await loop.tick()
    expect(loop.activeRuns).toBe(1)
    expect(api.queued).toEqual([])
    await loop.idle()
    expect(peak).toBe(1)
  })

  it('turns an adapter crash into a failed run', async () => {
    const adapter = new FakeAdapter(async () => {
      throw new Error('spawn claude ENOENT')
    })
    const { api, loop, enqueue } = await world(adapter)
    enqueue('run-7')
    await loop.tick()
    await loop.idle()
    expect(api.completions[0]).toMatchObject({
      outcome: 'failed',
      failureReason: 'spawn claude ENOENT',
    })
  })
})
