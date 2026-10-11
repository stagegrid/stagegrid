import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { serve } from '@hono/node-server'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { ClaudeAdapter } from '../../../runner/src/adapters/claude'
import { RunnerApi } from '../../../runner/src/api'
import { configSchema } from '../../../runner/src/config'
import { RunnerLoop } from '../../../runner/src/loop'
import { runEvents, runs } from '../../src/db/schema'
import { getBoard } from '../../src/services/board.service'
import { createEmployee } from '../../src/services/employees.service'
import { answerQuestion, listBatches } from '../../src/services/questions.service'
import { createEnrollment } from '../../src/services/runners.service'
import { cancelRun, listRuns, startRun } from '../../src/services/runs.service'
import {
  createTask,
  getTask,
  pinContext,
  setCellProgressMode,
  transitionTask,
} from '../../src/services/tasks.service'
import { getAttention } from '../../src/services/thread.service'
import { makeApp } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'
import { createUser, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()

/** A stand-in for `claude -p`: edits a file in the worktree, commits, and prints Claude's stream format. */
const FAKE_CLAUDE = `
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const out = (e) => process.stdout.write(JSON.stringify(e) + '\\n')
const args = process.argv.slice(2)
const sid = args[args.indexOf('--session-id') + 1] ?? args[args.indexOf('--resume') + 1]
out({ type: 'system', subtype: 'init', session_id: sid })
const resuming = args.includes('--resume')
const prompt = args[args.length - 1]
if (process.env.FAKE_MODE === 'ask' && !resuming) {
  out({
    type: 'result', subtype: 'success', is_error: false, session_id: sid,
    structured_output: {
      status: 'needs_answers', summary: 'Two rules are unclear', commit: null, tests: null,
      questions: [
        { prompt: 'Reject the second booking?', options: ['Yes', 'No'] },
        { prompt: 'Slot length in minutes?', options: [] },
      ],
    },
  })
} else if (process.env.FAKE_MODE === 'ask' && !prompt.includes('Answer: 30')) {
  out({
    type: 'result', subtype: 'success', is_error: false, session_id: sid,
    structured_output: { status: 'blocked', summary: 'The answers did not reach me', commit: null, tests: null, questions: [] },
  })
} else if (process.env.FAKE_MODE === 'hang') {
  setInterval(() => out({ type: 'assistant', message: { content: [{ type: 'text', text: 'still working' }] } }), 60)
} else {
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Adding the feature' }] } })
  fs.writeFileSync('feature.txt', 'email login\\n')
  execSync('git add -A && git commit -q -m "feat: email login"')
  const commit = execSync('git rev-parse HEAD').toString().trim()
  out({
    type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 0.1,
    structured_output: { status: 'submitted', summary: 'Added email login', commit, tests: '3 passed', questions: [] },
  })
}
`

async function setup() {
  const db = getDb()
  const now = () => new Date()
  const { app } = makeApp(db, { now })
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' })
  await new Promise<void>((r) => server.once('listening', () => r()))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const admin = await createUser(db, { isAdmin: true, name: 'Pond' })
  const project = await seedProject(db, admin, { tree: [{ name: 'Login' }] })
  const ctx = makeCtx(db, admin, now)
  const board = await getBoard(ctx, project.id)
  const stage = board.stages.find((s) => s.name === 'Implement')!
  const cellId = board.cells[board.items[0]!.id]![stage.id]!.id
  await setCellProgressMode(ctx, project.id, cellId, 'tasks')
  const mali = await createEmployee(ctx, project.id, {
    displayName: 'Mali',
    role: 'dev',
    provider: 'claude_code',
    model: null,
    instructions: '',
    avatar: null,
  })

  // The project's clone on the runner machine.
  const repo = await mkdtemp(join(tmpdir(), 'sg-it-repo-'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'T')
  await writeFile(join(repo, 'README.md'), 'hello\n')
  git('add', '.')
  git('commit', '-m', 'init')

  // The runner enrols with a one-time token over HTTP, exactly as a real one would.
  const enrollment = await createEnrollment(ctx, { name: 'it-runner', projectIds: [project.id] })
  const { credential } = await RunnerApi.enroll(url, {
    token: enrollment.token,
    providers: ['claude_code'],
  })

  const bin = join(await mkdtemp(join(tmpdir(), 'sg-it-bin-')), 'claude')
  await writeFile(bin, `#!${process.execPath}\n${FAKE_CLAUDE}`)
  await chmod(bin, 0o755)

  const config = configSchema.parse({
    url,
    credential,
    repos: { [project.slug]: { path: repo, baseBranch: 'main' } },
    worktreesDir: await mkdtemp(join(tmpdir(), 'sg-it-wt-')),
    pollWaitSeconds: 0,
  })
  const loop = new RunnerLoop({
    api: new RunnerApi(url, credential),
    config,
    adapters: [new ClaudeAdapter({ bin })],
    progressIntervalMs: 50,
  })

  const t = await createTask(ctx, project.id, {
    cellId,
    title: 'Email login',
    scope: 'Sign in with email and password',
    acceptanceCriteria: ['Wrong password is rejected'],
    required: true,
    ownerUserId: null,
    employeeId: mali.id,
  })
  const pinned = await pinContext(ctx, project.id, t.id, {
    documentIds: [],
    sources: [],
    decisions: ['Email and password only'],
  })
  const ready = await transitionTask(ctx, project.id, t.id, {
    action: 'mark_ready',
    expectedVersion: t.version,
  })
  const run = await startRun(ctx, project.id, t.id, {
    expectedVersion: ready.version,
    contextRevisionId: pinned.revisionId,
    idempotencyKey: 'it-1',
  })
  return { db, ctx, project, task: t, run, loop, repo, close: () => server.close() }
}

describe('a real runner against a real server', () => {
  it('takes a queued run through claim, work, commit and completion', async () => {
    const s = await setup()
    try {
      await s.loop.tick()
      await s.loop.idle()

      const task = await getTask(s.ctx, s.project.id, s.task.id)
      expect(task.state).toBe('ready_for_acceptance')
      expect(task.run).toMatchObject({ state: 'succeeded', runnerName: 'it-runner', attempt: 1 })
      const [saved] = await s.db.db.select().from(runs).where(eq(runs.id, s.run.id))
      expect(saved!.summary).toContain('Added email login')
      expect(saved!.summary).toContain('Tests: 3 passed')
      expect(saved!.sessionRef).toMatch(/^[0-9a-f-]{36}$/)
      const events = await s.db.db.select().from(runEvents).where(eq(runEvents.runId, s.run.id))
      expect(events.map((e) => e.type)).toContain('session')

      // The employee's commit is on its own branch; the person's checkout was never touched.
      const branches = execFileSync('git', ['branch', '--list', 'stagegrid/*'], { cwd: s.repo })
        .toString()
        .trim()
      expect(branches).toMatch(/stagegrid\/task-/)
      expect(
        execFileSync('git', ['branch', '--show-current'], { cwd: s.repo }).toString().trim(),
      ).toBe('main')
      expect(await readFile(join(s.repo, 'README.md'), 'utf8')).toBe('hello\n')
      const log = execFileSync(
        'git',
        ['log', '--format=%an|%s', '-1', branches.replace(/^[*+]\s*/, '')],
        {
          cwd: s.repo,
        },
      )
        .toString()
        .trim()
      expect(log).toBe('Mali (AI)|feat: email login')
    } finally {
      s.close()
    }
  })

  it('stops the agent when a person cancels the run, and reports nothing back', async () => {
    process.env.FAKE_MODE = 'hang'
    const s = await setup()
    try {
      const ticking = s.loop.tick()
      await ticking
      // Wait until the runner is working, then cancel.
      for (
        let i = 0;
        i < 100 && (await listRuns(s.ctx, s.project.id, s.task.id))[0]!.state !== 'running';
        i += 1
      )
        await new Promise((r) => setTimeout(r, 20))
      await new Promise((r) => setTimeout(r, 250))
      await cancelRun(s.ctx, s.project.id, s.run.id, 'Wrong task')
      await s.loop.idle()

      const task = await getTask(s.ctx, s.project.id, s.task.id)
      expect(task.state).toBe('ready')
      expect(task.run).toMatchObject({ state: 'cancelled' })
      expect(s.loop.activeRuns).toBe(0)
    } finally {
      delete process.env.FAKE_MODE
      s.close()
    }
  })

  it('asks its questions, waits for the answers, then continues the same session with them', async () => {
    process.env.FAKE_MODE = 'ask'
    const s = await setup()
    try {
      await s.loop.tick()
      await s.loop.idle()
      let task = await getTask(s.ctx, s.project.id, s.task.id)
      expect(task.state).toBe('waiting_for_answer')
      expect(task.run).toMatchObject({ state: 'waiting_for_answer' })
      const [batch] = await listBatches(s.ctx, s.project.id, s.task.id)
      expect(batch!.questions.map((q) => q.prompt)).toEqual([
        'Reject the second booking?',
        'Slot length in minutes?',
      ])
      expect((await getAttention(s.ctx, s.project.id))[0]).toMatchObject({ kind: 'question' })
      const [first] = await s.db.db.select().from(runs).where(eq(runs.id, s.run.id))
      expect(first!.sessionRef).toBeTruthy()

      await answerQuestion(s.ctx, s.project.id, batch!.questions[0]!.id, {
        answer: 'Yes',
        idempotencyKey: 'a1',
        changesScope: false,
      })
      await answerQuestion(s.ctx, s.project.id, batch!.questions[1]!.id, {
        answer: '30',
        idempotencyKey: 'a2',
        changesScope: false,
      })
      await s.loop.tick()
      await s.loop.idle()

      task = await getTask(s.ctx, s.project.id, s.task.id)
      expect(task.state).toBe('ready_for_acceptance')
      expect(task.run).toMatchObject({ state: 'succeeded', attempt: 1 })
      const [done] = await s.db.db.select().from(runs).where(eq(runs.id, s.run.id))
      expect(done!.sessionRef).toBe(first!.sessionRef)
      expect(done!.summary).toContain('Added email login')
    } finally {
      delete process.env.FAKE_MODE
      s.close()
    }
  })
})
