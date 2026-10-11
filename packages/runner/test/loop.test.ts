import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClaimedRunDto, QueuedRunDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import type { AdapterInput, AdapterOutcome, AgentAdapter } from '../src/adapters/types'
import { type AskBody, type CompleteBody, type RunEventBody, RunnerApiError } from '../src/api'
import { configSchema } from '../src/config'
import { type LoopApi, RunnerLoop } from '../src/loop'

class FakeApi implements LoopApi {
  queued: QueuedRunDto[] = []
  claims = new Map<string, ClaimedRunDto>()
  claimError: RunnerApiError | null = null
  heartbeatError: RunnerApiError | null = null
  events: RunEventBody[] = []
  completions: CompleteBody[] = []
  asked: { runId: string; body: AskBody }[] = []
  askError: RunnerApiError | null = null
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
  async ask(runId: string, body: AskBody) {
    if (this.askError) throw this.askError
    this.asked.push({ runId, body })
    return {}
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
      lastSequence: 0,
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
    delivery: { mode: 'local', repo: null },
    role: 'dev',
    checkout: null,
    examine: null,
    feedback: [],
    analyst: null,
    answers: [],
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

async function world(
  adapter: FakeAdapter,
  opts: { repo?: boolean; max?: number; testCommand?: string } = {},
) {
  const api = new FakeApi()
  const repo = opts.repo === false ? undefined : await repoDir()
  const config = configSchema.parse({
    url: 'https://sg.example.com',
    credential: 'sg_runner_x',
    worktreesDir: await mkdtemp(join(tmpdir(), 'sg-loop-wt-')),
    repos: repo ? { pilot: { path: repo, baseBranch: 'main', testCommand: opts.testCommand } } : {},
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

/** What a real agent does before it reports success: change something and commit it in its worktree. */
function commitIn(cwd: string): string {
  execFileSync('git', ['config', 'user.email', 'ai@example.com'], { cwd })
  execFileSync('git', ['config', 'user.name', 'AI'], { cwd })
  execFileSync(
    'sh',
    ['-c', 'echo work >> work.txt && git add -A && git commit -q -m "feat: work"'],
    { cwd },
  )
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim()
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
    let head = ''
    const adapter = new FakeAdapter(async (i, _s, emit) => {
      emit({ type: 'session', sessionRef: 'sess-1' } as never)
      emit({ type: 'progress', message: 'Writing tests' } as never)
      await new Promise((r) => setTimeout(r, 60))
      head = commitIn(i.cwd)
      return finished({ commit: head })
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
        summary: 'Implemented',
        submission: {
          artifacts: [
            expect.objectContaining({ kind: 'commit', headCommit: head, url: null, repo: null }),
          ],
          verification: [
            {
              command: 'The agent reported: 9 passed',
              exitCode: 0,
              commit: head,
              source: 'agent_reported',
              output: null,
            },
          ],
        },
      },
    ])
    expect(loop.activeRuns).toBe(0)
  })

  it('resumes the same session for a continuation', async () => {
    const adapter = new FakeAdapter(async (i) => finished({ commit: commitIn(i.cwd) }))
    const { loop, enqueue } = await world(adapter)
    enqueue('run-2', { sessionRef: 'sess-9' })
    await loop.tick()
    await loop.idle()
    expect(adapter.inputs[0]!.sessionRef).toBe('sess-9')
    expect(adapter.inputs[0]!.prompt).toContain('continuing an earlier session')
  })

  it('does not take the agent at its word: no commit means no success', async () => {
    const adapter = new FakeAdapter(async () => finished({ commit: 'abc1234' }))
    const { api, loop, enqueue } = await world(adapter)
    enqueue('run-nc')
    await loop.tick()
    await loop.idle()
    expect(api.completions[0]).toMatchObject({
      outcome: 'failed',
      failureReason: 'The agent reported success but made no commit.',
    })
    expect(api.completions[0]!.submission).toBeUndefined()
  })

  it('fails when the agent leaves tracked changes uncommitted', async () => {
    const adapter = new FakeAdapter(async (i) => {
      commitIn(i.cwd)
      execFileSync('sh', ['-c', 'echo more >> work.txt'], { cwd: i.cwd })
      return finished()
    })
    const { api, loop, enqueue } = await world(adapter)
    enqueue('run-dirty')
    await loop.tick()
    await loop.idle()
    expect(api.completions[0]).toMatchObject({ outcome: 'failed' })
    expect(api.completions[0]!.failureReason).toMatch(/uncommitted changes/)
  })

  it("runs the project's test command itself and reports its exit code as runner evidence", async () => {
    const adapter = new FakeAdapter(async (i) => finished({ commit: commitIn(i.cwd), tests: null }))
    const w = await world(adapter, { testCommand: 'echo checking && exit 3' })
    w.enqueue('run-t')
    await w.loop.tick()
    await w.loop.idle()
    const [done] = w.api.completions
    expect(done).toMatchObject({ outcome: 'succeeded' })
    expect(done!.submission!.verification).toEqual([
      expect.objectContaining({
        command: 'echo checking && exit 3',
        exitCode: 3,
        source: 'runner_reported',
        output: expect.stringContaining('checking'),
      }),
    ])
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

  it('asks its questions and stops, without completing the run', async () => {
    const adapter = new FakeAdapter(async () => ({
      kind: 'needs_answers',
      summary: 'Two rules are unclear',
      questions: [
        { prompt: 'Reject the second booking?', options: ['Yes', 'No'] },
        { prompt: 'Slot length?', options: [] },
      ],
    }))
    const { api, loop, enqueue } = await world(adapter)
    enqueue('run-ask')
    await loop.tick()
    await loop.idle()
    expect(api.asked).toEqual([
      {
        runId: 'run-ask',
        body: {
          questions: [
            { prompt: 'Reject the second booking?', options: ['Yes', 'No'] },
            { prompt: 'Slot length?', options: [] },
          ],
          contextRevisionId: 'r1',
          idempotencyKey: 'run-ask:4:ask',
          fencingToken: 4,
        },
      },
    ])
    expect(api.completions).toEqual([])
  })

  it('fails the run if its questions cannot be asked, but not if the lease is gone', async () => {
    const outcome: AdapterOutcome = {
      kind: 'needs_answers',
      summary: 's',
      questions: [{ prompt: 'Q?', options: [] }],
    }
    const failing = await world(new FakeAdapter(async () => outcome))
    failing.api.askError = new RunnerApiError(409, 'conflict', 'Already open', {
      code: 'batch_open',
    })
    failing.enqueue('a')
    await failing.loop.tick()
    await failing.loop.idle()
    expect(failing.api.completions[0]).toMatchObject({ outcome: 'failed' })
    expect(failing.api.completions[0]!.failureReason).toMatch(/Couldn't ask its questions/)

    const gone = await world(new FakeAdapter(async () => outcome))
    gone.api.askError = stale
    gone.enqueue('b')
    await gone.loop.tick()
    await gone.loop.idle()
    expect(gone.api.completions).toEqual([])
  })

  it('continues with the answers it was given', async () => {
    const adapter = new FakeAdapter(async () => finished())
    const { api, loop, enqueue } = await world(adapter)
    enqueue('run-cont', { sessionRef: 'sess-3' })
    api.claims.get('run-cont')!.answers = [
      { question: 'Reject the second booking?', answer: 'Yes' },
    ]
    await loop.tick()
    await loop.idle()
    const prompt = adapter.inputs[0]!.prompt
    expect(prompt).toContain('Answers to your questions')
    expect(prompt).toContain('Reject the second booking?')
    expect(prompt).toContain('Answer: Yes')
    expect(prompt).toContain('questions have been answered')
  })

  describe('other roles', () => {
    const enqueueRole = async (
      w: Awaited<ReturnType<typeof world>>,
      id: string,
      role: 'reviewer' | 'qa' | 'analyst',
      extra: Record<string, unknown> = {},
    ) => {
      w.enqueue(id)
      const claim = w.api.claims.get(id)!
      const repoPath = (
        w.loop as unknown as { opts: { config: { repos: Record<string, { path: string }> } } }
      ).opts.config.repos.pilot!.path
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath }).toString().trim()
      Object.assign(claim, { role, checkout: role === 'analyst' ? null : head, ...extra })
      return head
    }

    it('lets a reviewer look at a fresh checkout of the delivery and report a verdict', async () => {
      const adapter = new FakeAdapter(async () => ({
        kind: 'review',
        report: {
          verdict: 'changes_requested',
          summary: 'No lockout',
          findings: [{ severity: 'major', text: 'Missing lockout', file: 'a.ts' }],
        },
      }))
      const w = await world(adapter)
      const head = await enqueueRole(w, 'run-rv', 'reviewer', {
        examine: { headCommit: 'abc1234', summary: 'Built it', artifacts: [], checks: [] },
      })
      await w.loop.tick()
      await w.loop.idle()
      const input = adapter.inputs[0]!
      expect(input.role).toBe('reviewer')
      expect(input.cwd).toContain('-reviewer-')
      expect(await readFile(join(input.cwd, 'a.txt'), 'utf8')).toBe('a\n')
      expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: input.cwd }).toString().trim()).toBe(
        head,
      )
      expect(input.systemPrompt).toContain('You never change code')
      expect(input.prompt).toContain('The delivery you examine')
      expect(w.api.completions[0]).toMatchObject({
        outcome: 'succeeded',
        review: { verdict: 'changes_requested', summary: 'No lockout' },
      })
      expect(w.api.completions[0]!.submission).toBeUndefined()
    })

    it('has QA tested at the accepted commit, with the runner running the tests itself', async () => {
      const adapter = new FakeAdapter(async () => ({
        kind: 'qa',
        report: {
          verdict: 'pass',
          summary: 'All good',
          findings: [],
          results: [{ criterion: 'Wrong password is rejected', result: 'pass', evidence: 'tried' }],
        },
      }))
      const w = await world(adapter, { testCommand: 'test -f a.txt' })
      const head = await enqueueRole(w, 'run-qa', 'qa')
      await w.loop.tick()
      await w.loop.idle()
      const [done] = w.api.completions
      expect(done).toMatchObject({ outcome: 'succeeded', qa: { verdict: 'pass' } })
      expect(done!.checks).toEqual([
        expect.objectContaining({
          command: 'test -f a.txt',
          exitCode: 0,
          commit: head,
          source: 'runner_reported',
        }),
      ])
    })

    it('has an analyst submit documents without needing a commit', async () => {
      const adapter = new FakeAdapter(async () => ({
        kind: 'analyst',
        summary: 'Drafted',
        documents: [{ template: 'srs', title: 'SRS', sections: [{ id: '1.1', content: 'Text' }] }],
      }))
      const w = await world(adapter)
      await enqueueRole(w, 'run-an', 'analyst', {
        analyst: {
          itemPath: 'Login',
          templates: [
            { key: 'srs', name: 'SRS', sections: [{ id: '1.1', number: '1.1', title: 'Purpose' }] },
          ],
        },
      })
      await w.loop.tick()
      await w.loop.idle()
      expect(adapter.inputs[0]!.prompt).toContain('key: srs')
      expect(w.api.completions[0]).toMatchObject({
        outcome: 'succeeded',
        documents: [{ template: 'srs', sections: [{ id: '1.1', content: 'Text' }] }],
      })
    })
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
