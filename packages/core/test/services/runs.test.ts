import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { runEvents, runners, runs } from '../../src/db/schema'
import { getBoard, getCellDetail } from '../../src/services/board.service'
import { saveDocDraft } from '../../src/services/docs.service'
import { createEmployee } from '../../src/services/employees.service'
import {
  authenticateRunner,
  createEnrollment,
  enrollRunner,
  listRunners,
  reportCapacity,
  revokeRunner,
  updateRunner,
} from '../../src/services/runners.service'
import {
  cancelRun,
  claimRun,
  completeRun,
  expireLeases,
  heartbeatRun,
  listRuns,
  recordRunEvent,
  runnerQueue,
  startRun,
} from '../../src/services/runs.service'
import {
  createTask,
  getTask,
  pinContext,
  setCellProgressMode,
  transitionTask,
} from '../../src/services/tasks.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, createUser, FIXED_NOW, makeCtx, seedProject } from '../helpers/factories'
import { captureEvents } from '../helpers/listen'

const getDb = useTestDatabase()

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true, name: 'Pond' })
  const project = await seedProject(db, admin, { tree: [{ name: 'Login' }] })
  let t = FIXED_NOW.getTime()
  const clock = { now: () => new Date(t), advance: (ms: number) => void (t += ms) }
  const ctx = makeCtx(db, admin, clock.now)
  const system = makeCtx(db, null, clock.now)
  const board = await getBoard(ctx, project.id)
  const item = board.items[0]!
  const stage = board.stages.find((s) => s.name === 'Implement')!
  const cellId = board.cells[item.id]![stage.id]!.id
  await setCellProgressMode(ctx, project.id, cellId, 'tasks')
  const mali = await createEmployee(ctx, project.id, {
    displayName: 'Mali',
    role: 'dev',
    provider: 'claude_code',
    model: 'sonnet',
    instructions: 'Write tests first.',
    avatar: null,
  })
  return { db, admin, project, clock, ctx, system, cellId, mali }
}
type World = Awaited<ReturnType<typeof setup>>

async function enroll(
  s: World,
  name = 'build-box',
  providers = ['claude_code'],
  projectIds?: string[],
) {
  const e = await createEnrollment(s.ctx, { name, projectIds: projectIds ?? [s.project.id] })
  const { credential, runner } = await enrollRunner(s.system, { token: e.token, providers })
  const row = (await authenticateRunner(s.db.db, s.ctx.config, credential, s.clock.now()))!
  return { credential, runner, row }
}

async function readyTask(s: World, title = 'Email login') {
  const t = await createTask(s.ctx, s.project.id, {
    cellId: s.cellId,
    title,
    scope: 'Sign in with email',
    acceptanceCriteria: ['Wrong password is rejected'],
    required: true,
    ownerUserId: null,
    employeeId: s.mali.id,
  })
  const ctxRev = await pinContext(s.ctx, s.project.id, t.id, {
    documentIds: [],
    sources: [],
    decisions: ['Email and password only'],
  })
  const ready = await transitionTask(s.ctx, s.project.id, t.id, {
    action: 'mark_ready',
    expectedVersion: t.version,
  })
  return { task: ready, contextRevisionId: ctxRev.revisionId }
}

const start = (s: World, taskId: string, contextRevisionId: string, key = 'k1', v?: number) =>
  startRun(s.ctx, s.project.id, taskId, {
    expectedVersion: v ?? 2,
    contextRevisionId,
    idempotencyKey: key,
  })

async function queuedRun(s: World) {
  const { task, contextRevisionId } = await readyTask(s)
  const run = await start(s, task.id, contextRevisionId, 'k1', task.version)
  return { task, contextRevisionId, run }
}

describe('enrolling a runner', () => {
  it('turns a one-time token into a credential, once', async () => {
    const s = await setup()
    const e = await createEnrollment(s.ctx, { name: 'box', projectIds: [s.project.id] })
    expect(e.token.startsWith('sg_enroll_')).toBe(true)
    const first = await enrollRunner(s.system, { token: e.token, providers: ['claude_code'] })
    expect(first.credential.startsWith('sg_runner_')).toBe(true)
    expect(first.runner).toMatchObject({ name: 'box', providers: ['claude_code'], online: true })
    await expect(
      enrollRunner(s.system, { token: e.token, providers: ['claude_code'] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('rejects an expired token and a made-up one', async () => {
    const s = await setup()
    const e = await createEnrollment(s.ctx, { name: 'box', projectIds: [s.project.id] })
    s.clock.advance(61 * 60_000)
    await expect(enrollRunner(s.system, { token: e.token, providers: [] })).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    await expect(
      enrollRunner(s.system, { token: 'sg_enroll_nope', providers: [] }),
    ).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  it('is admin-only, and runner credentials work until revoked', async () => {
    const s = await setup()
    const member = await createUser(s.db, { name: 'Ed' })
    await addMember(s.db, s.project.id, member.userId, 'owner')
    await expect(
      createEnrollment(makeCtx(s.db, member), { name: 'x', projectIds: [s.project.id] }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const r = await enroll(s)
    expect(
      await authenticateRunner(s.db.db, s.ctx.config, r.credential, s.clock.now()),
    ).not.toBeNull()
    await revokeRunner(s.ctx, r.runner.id)
    expect(await authenticateRunner(s.db.db, s.ctx.config, r.credential, s.clock.now())).toBeNull()
    expect((await listRunners(s.ctx))[0]).toMatchObject({ online: false })
    await expect(updateRunner(s.ctx, r.runner.id, { name: 'z' })).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})

describe('starting a run', () => {
  it('queues a run for a ready employee task and leaves the task ready', async () => {
    const s = await setup()
    await enroll(s)
    const { task, run } = await queuedRun(s)
    expect(run).toMatchObject({ state: 'queued', attempt: 1, runtime: { provider: 'claude_code' } })
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.state).toBe('ready')
    expect(after.run).toMatchObject({ id: run.id, state: 'queued' })
  })

  it('refuses to start without an online runner and creates nothing (AC-06)', async () => {
    const s = await setup()
    const { task, contextRevisionId } = await readyTask(s)
    const events = await captureEvents(async () => {
      await expect(start(s, task.id, contextRevisionId, 'k1', task.version)).rejects.toMatchObject({
        code: 'conflict',
        details: { code: 'runner_unavailable' },
      })
    })
    expect(events).toEqual([])
    expect(await s.db.db.select().from(runs)).toHaveLength(0)
    expect((await getTask(s.ctx, s.project.id, task.id)).state).toBe('ready')
    // A runner that went quiet is as unavailable as none at all.
    await enroll(s)
    s.clock.advance(3 * 60_000)
    await expect(start(s, task.id, contextRevisionId, 'k2', task.version)).rejects.toMatchObject({
      details: { code: 'runner_unavailable' },
    })
  })

  it('is idempotent on the key and allows one run in flight', async () => {
    const s = await setup()
    await enroll(s)
    const { task, contextRevisionId, run } = await queuedRun(s)
    const again = await start(s, task.id, contextRevisionId, 'k1', task.version)
    expect(again.id).toBe(run.id)
    await expect(start(s, task.id, contextRevisionId, 'k2', task.version)).rejects.toMatchObject({
      details: { code: 'run_active' },
    })
    await expect(
      start(s, task.id, '00000000-0000-4000-8000-000000000000', 'k1', task.version),
    ).rejects.toMatchObject({ details: { code: 'idempotency_conflict' } })
    expect(await s.db.db.select().from(runs)).toHaveLength(1)
  })

  it('needs the latest pinned context and the current task version', async () => {
    const s = await setup()
    await enroll(s)
    const { task, contextRevisionId } = await readyTask(s)
    await pinContext(s.ctx, s.project.id, task.id, {
      documentIds: [],
      sources: [],
      decisions: ['B'],
    })
    await expect(start(s, task.id, contextRevisionId, 'k1', task.version)).rejects.toMatchObject({
      details: { code: 'context_changed' },
    })
    const latest = (await getTask(s.ctx, s.project.id, task.id)).context!.revisionId
    await expect(start(s, task.id, latest, 'k2', 99)).rejects.toMatchObject({
      details: { code: 'stale_version' },
    })
  })

  it('needs an employee, an editor, and a startable task', async () => {
    const s = await setup()
    await enroll(s)
    const human = await createTask(s.ctx, s.project.id, {
      cellId: s.cellId,
      title: 'By hand',
      scope: '',
      acceptanceCriteria: [],
      required: true,
      ownerUserId: null,
      employeeId: null,
    })
    await expect(
      start(s, human.id, '00000000-0000-4000-8000-000000000000', 'k', 1),
    ).rejects.toMatchObject({ code: 'conflict' })
    const { task, contextRevisionId } = await readyTask(s)
    const viewer = await createUser(s.db, { name: 'Vi' })
    await addMember(s.db, s.project.id, viewer.userId, 'viewer')
    await expect(
      startRun(makeCtx(s.db, viewer, s.clock.now), s.project.id, task.id, {
        expectedVersion: task.version,
        contextRevisionId,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const draft = await createTask(s.ctx, s.project.id, {
      cellId: s.cellId,
      title: 'Draft',
      scope: '',
      acceptanceCriteria: [],
      required: true,
      ownerUserId: null,
      employeeId: s.mali.id,
    })
    await expect(start(s, draft.id, contextRevisionId, 'k', 1)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it("won't let a person start or submit an employee's task by hand", async () => {
    const s = await setup()
    const { task } = await readyTask(s)
    await expect(
      transitionTask(s.ctx, s.project.id, task.id, {
        action: 'start',
        expectedVersion: task.version,
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { code: 'employee_task' } })
  })
})

describe('claiming', () => {
  it('moves the task to in progress and hands over everything the runner needs', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const { task, run } = await queuedRun(s)
    const queue = await runnerQueue(s.system, row)
    expect(queue).toEqual([
      expect.objectContaining({ id: run.id, taskTitle: 'Email login', provider: 'claude_code' }),
    ])
    const claim = await claimRun(s.system, row, run.id, { idempotencyKey: 'c1' })
    expect(claim.run).toMatchObject({ fencingToken: 1, sessionRef: null })
    expect(claim.run.runtime).toMatchObject({
      provider: 'claude_code',
      instructions: 'Write tests first.',
    })
    expect(claim.task).toMatchObject({
      title: 'Email login',
      acceptanceCriteria: ['Wrong password is rejected'],
    })
    expect(claim.context.manifest.decisions).toEqual(['Email and password only'])
    expect(claim.employee).toMatchObject({ displayName: 'Mali' })
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.state).toBe('in_progress')
    expect(after.run).toMatchObject({ state: 'running', runnerName: 'build-box' })
    expect(await runnerQueue(s.system, row)).toEqual([])
    const cell = await getCellDetail(s.ctx, s.project.id, s.cellId)
    expect(cell.status).toBe('doing')
  })

  it('hands the runner the pinned document revisions as Markdown, not the latest edits', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const doc = await saveDocDraft(s.ctx, s.project.id, {
      template: 'srs',
      item: 'Login',
      stage: 'Document',
      draft: { sections: { '1.1': 'Sign in with email and password' } },
    })
    const t = await createTask(s.ctx, s.project.id, {
      cellId: s.cellId,
      title: 'Doc task',
      scope: '',
      acceptanceCriteria: [],
      required: true,
      ownerUserId: null,
      employeeId: s.mali.id,
    })
    const pinned = await pinContext(s.ctx, s.project.id, t.id, {
      documentIds: [doc.documentId],
      sources: [],
      decisions: [],
    })
    await saveDocDraft(s.ctx, s.project.id, {
      template: 'srs',
      documentId: doc.documentId,
      draft: { sections: { '1.1': 'Totally different text' } },
    })
    const ready = await transitionTask(s.ctx, s.project.id, t.id, {
      action: 'mark_ready',
      expectedVersion: t.version,
    })
    const run = await startRun(s.ctx, s.project.id, t.id, {
      expectedVersion: ready.version,
      contextRevisionId: pinned.revisionId,
      idempotencyKey: 'k',
    })
    const claim = await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })
    expect(claim.documents).toHaveLength(1)
    expect(claim.documents[0]!.markdown).toContain('Sign in with email and password')
    expect(claim.documents[0]!.markdown).not.toContain('Totally different text')
  })

  it('gives exactly one of two simultaneous claimers the run (AC-03)', async () => {
    const s = await setup()
    const a = await enroll(s, 'a')
    const b = await enroll(s, 'b')
    const { run } = await queuedRun(s)
    const results = await Promise.allSettled([
      claimRun(s.system, a.row, run.id, { idempotencyKey: 'x' }),
      claimRun(s.system, b.row, run.id, { idempotencyKey: 'y' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(lost.reason).toMatchObject({ code: 'conflict', details: { code: 'claim_conflict' } })
    const [row] = await s.db.db.select().from(runs).where(eq(runs.id, run.id))
    expect(row!.fencingToken).toBe(1)
  })

  it('answers a repeated claim with the same lease, but not a different key (lost acknowledgment)', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const { run } = await queuedRun(s)
    const first = await claimRun(s.system, row, run.id, { idempotencyKey: 'same' })
    const again = await claimRun(s.system, row, run.id, { idempotencyKey: 'same' })
    expect(again.run.fencingToken).toBe(first.run.fencingToken)
    await expect(
      claimRun(s.system, row, run.id, { idempotencyKey: 'other' }),
    ).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('hides runs from runners without the project or the provider', async () => {
    const s = await setup()
    const other = await seedProject(s.db, s.admin, { name: 'Other' })
    const wrongProject = await enroll(s, 'p', ['claude_code'], [other.id])
    const wrongProvider = await enroll(s, 'q', ['codex'])
    await enroll(s, 'right-one')
    const { run } = await queuedRun(s)
    for (const r of [wrongProject, wrongProvider]) {
      expect(await runnerQueue(s.system, r.row)).toEqual([])
      await expect(
        claimRun(s.system, r.row, run.id, { idempotencyKey: 'k' }),
      ).rejects.toMatchObject({
        code: 'not_found',
      })
    }
  })

  it('respects the runner concurrency limit', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const first = await queuedRun(s)
    const second = await readyTask(s, 'Second')
    await claimRun(s.system, row, first.run.id, { idempotencyKey: 'a' })
    const run2 = await startRun(s.ctx, s.project.id, second.task.id, {
      expectedVersion: second.task.version,
      contextRevisionId: second.contextRevisionId,
      idempotencyKey: 'k2',
    })
    await expect(claimRun(s.system, row, run2.id, { idempotencyKey: 'b' })).rejects.toMatchObject({
      details: { code: 'runner_busy' },
    })
    // Raising the limit lets the second task run alongside the first.
    await updateRunner(s.ctx, row.id, { maxConcurrent: 2 })
    const raised = (await s.db.db.select().from(runners).where(eq(runners.id, row.id)))[0]!
    expect(
      (await claimRun(s.system, raised, run2.id, { idempotencyKey: 'b' })).run.fencingToken,
    ).toBe(1)
  })
})

describe('while running', () => {
  async function running(s: World) {
    const { row } = await enroll(s)
    const { task, run } = await queuedRun(s)
    const claim = await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })
    return { row, task, run, token: claim.run.fencingToken }
  }

  it('extends the lease on heartbeat and refuses a stale token', async () => {
    const s = await setup()
    const { row, run, token } = await running(s)
    s.clock.advance(60_000)
    const beat = await heartbeatRun(s.system, row, run.id, token)
    expect(new Date(beat.leaseExpiresAt).getTime()).toBe(s.clock.now().getTime() + 90_000)
    await expect(heartbeatRun(s.system, row, run.id, token + 1)).rejects.toMatchObject({
      details: { code: 'stale_fencing' },
    })
  })

  it('stores events once, in order, and remembers the session', async () => {
    const s = await setup()
    const { row, run, token } = await running(s)
    const ev = (n: number, extra = {}) => ({
      eventId: `e${n}`,
      sequence: n,
      type: 'progress' as const,
      payload: { message: `step ${n}` },
      fencingToken: token,
      ...extra,
    })
    await recordRunEvent(s.system, row, run.id, {
      ...ev(1),
      type: 'session',
      payload: { sessionRef: 'sess-1' },
    })
    expect(await recordRunEvent(s.system, row, run.id, ev(2))).toMatchObject({ duplicate: false })
    expect(await recordRunEvent(s.system, row, run.id, ev(2))).toMatchObject({ duplicate: true })
    await expect(
      recordRunEvent(s.system, row, run.id, ev(1, { eventId: 'late' })),
    ).rejects.toMatchObject({
      details: { code: 'out_of_order' },
    })
    expect(await s.db.db.select().from(runEvents)).toHaveLength(2)
    const [saved] = await s.db.db.select().from(runs).where(eq(runs.id, run.id))
    expect(saved).toMatchObject({ sessionRef: 'sess-1', lastSequence: 2 })
  })

  it('submits the task for acceptance when the run succeeds, and repeats safely', async () => {
    const s = await setup()
    const { row, task, run, token } = await running(s)
    const done = await completeRun(s.system, row, run.id, {
      fencingToken: token,
      idempotencyKey: 'done-1',
      outcome: 'succeeded',
      summary: 'Implemented and tested.',
    })
    expect(done).toMatchObject({ state: 'succeeded', summary: 'Implemented and tested.' })
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.state).toBe('ready_for_acceptance')
    expect(after.actions).toContain('accept')
    const replay = await completeRun(s.system, row, run.id, {
      fencingToken: token,
      idempotencyKey: 'done-1',
      outcome: 'succeeded',
    })
    expect(replay.id).toBe(done.id)
    await expect(
      completeRun(s.system, row, run.id, {
        fencingToken: token,
        idempotencyKey: 'done-1',
        outcome: 'failed',
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await getTask(s.ctx, s.project.id, task.id)).version).toBe(after.version)
  })

  it('leaves the task in progress, with the problem visible, when a run fails', async () => {
    const s = await setup()
    const { row, task, run, token } = await running(s)
    await completeRun(s.system, row, run.id, {
      fencingToken: token,
      idempotencyKey: 'f',
      outcome: 'failed',
      failureReason: 'Tests did not pass',
    })
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.state).toBe('in_progress')
    expect(after.run).toMatchObject({ state: 'failed', failureReason: 'Tests did not pass' })
  })
})

describe('losing the runner', () => {
  it('interrupts a run whose lease ran out and never completes the task (AC-07)', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const { task, run } = await queuedRun(s)
    await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })
    s.clock.advance(60_000)
    expect(await expireLeases(s.system)).toBe(0)
    s.clock.advance(31_000)
    expect(await expireLeases(s.system)).toBe(1)
    expect(await expireLeases(s.system)).toBe(0)
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.state).toBe('in_progress')
    expect(after.run).toMatchObject({ state: 'interrupted' })
    expect(after.run?.failureReason).toMatch(/stopped responding/)
  })

  it('ignores a late success from the old lease (AC-08)', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const { task, run } = await queuedRun(s)
    const claim = await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })
    s.clock.advance(91_000)
    await expireLeases(s.system)
    await expect(
      completeRun(s.system, row, run.id, {
        fencingToken: claim.run.fencingToken,
        idempotencyKey: 'late',
        outcome: 'succeeded',
        summary: 'Done!',
      }),
    ).rejects.toMatchObject({ details: { code: 'stale_fencing' } })
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.state).toBe('in_progress')
    expect((await listRuns(s.ctx, s.project.id, task.id))[0]!.state).toBe('interrupted')
  })

  it('lets a person retry an interrupted run as a new attempt with a new lease', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const { task, contextRevisionId, run } = await queuedRun(s)
    const first = await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })
    s.clock.advance(91_000)
    await expireLeases(s.system)
    const current = await getTask(s.ctx, s.project.id, task.id)
    s.clock.advance(60_000)
    await enroll(s, 'fresh')
    const retry = await startRun(s.ctx, s.project.id, task.id, {
      expectedVersion: current.version,
      contextRevisionId,
      idempotencyKey: 'retry',
    })
    expect(retry.attempt).toBe(2)
    const second = await claimRun(s.system, row, retry.id, { idempotencyKey: 'c2' })
    expect(second.run.fencingToken).toBe(1)
    expect(second.run.id).not.toBe(first.run.id)
    expect((await getTask(s.ctx, s.project.id, task.id)).state).toBe('in_progress')
  })
})

describe('cancelling', () => {
  it('stops a queued run and keeps the task ready', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const { task, run } = await queuedRun(s)
    await cancelRun(s.ctx, s.project.id, run.id, 'Changed my mind')
    expect((await getTask(s.ctx, s.project.id, task.id)).state).toBe('ready')
    expect(await runnerQueue(s.system, row)).toEqual([])
    await expect(claimRun(s.system, row, run.id, { idempotencyKey: 'c' })).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('revokes a running claim: the old runner can no longer report anything (AC-16)', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const { task, run } = await queuedRun(s)
    const claim = await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })
    await cancelRun(s.ctx, s.project.id, run.id, 'Wrong task')
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.state).toBe('ready')
    expect(after.run).toMatchObject({ state: 'cancelled' })
    const t = claim.run.fencingToken
    await expect(heartbeatRun(s.system, row, run.id, t)).rejects.toMatchObject({
      details: { code: 'stale_fencing' },
    })
    await expect(
      recordRunEvent(s.system, row, run.id, {
        eventId: 'x',
        sequence: 1,
        type: 'progress',
        payload: {},
        fencingToken: t,
      }),
    ).rejects.toMatchObject({ details: { code: 'stale_fencing' } })
    await expect(
      completeRun(s.system, row, run.id, {
        fencingToken: t,
        idempotencyKey: 'z',
        outcome: 'succeeded',
      }),
    ).rejects.toMatchObject({ details: { code: 'stale_fencing' } })
    expect((await getTask(s.ctx, s.project.id, task.id)).state).toBe('ready')
    await expect(cancelRun(s.ctx, s.project.id, run.id)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('returns a rework task to changes requested', async () => {
    const s = await setup()
    const { row } = await enroll(s)
    const { task, run } = await queuedRun(s)
    const claim = await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })
    await completeRun(s.system, row, run.id, {
      fencingToken: claim.run.fencingToken,
      idempotencyKey: 'd',
      outcome: 'succeeded',
    })
    const submitted = await getTask(s.ctx, s.project.id, task.id)
    const changes = await transitionTask(s.ctx, s.project.id, task.id, {
      action: 'request_changes',
      expectedVersion: submitted.version,
      reason: 'Handle lockout',
    })
    const ctxRev = (await getTask(s.ctx, s.project.id, task.id)).context!.revisionId
    const rework = await startRun(s.ctx, s.project.id, task.id, {
      expectedVersion: changes.version,
      contextRevisionId: ctxRev,
      idempotencyKey: 'rework',
    })
    const c2 = await claimRun(s.system, row, rework.id, { idempotencyKey: 'c2' })
    expect(c2.run.attempt).toBe(2)
    await cancelRun(s.ctx, s.project.id, rework.id)
    expect((await getTask(s.ctx, s.project.id, task.id)).state).toBe('changes_requested')
  })

  it('cannot cancel runs of another project', async () => {
    const s = await setup()
    await enroll(s)
    const { run } = await queuedRun(s)
    const other = await seedProject(s.db, s.admin, { name: 'Other' })
    await expect(cancelRun(s.ctx, other.id, run.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('usage limits', () => {
  const usage = (fiveHour: number, weekly: number, resets = '2026-10-20T07:00:00Z') => ({
    provider: 'claude_code',
    fiveHour: { percent: fiveHour, resetsAt: resets },
    weekly: { percent: weekly, resetsAt: '2026-10-25T00:00:00Z' },
  })
  const fresh = async (s: World, credential: string) =>
    (await authenticateRunner(s.db.db, s.ctx.config, credential, s.clock.now()))!

  it('keeps new runs queued above the ceiling and starts them when usage drops (AC-26)', async () => {
    const s = await setup()
    const r = await enroll(s)
    await reportCapacity(s.system, r.row, usage(85, 10))
    const { run } = await queuedRun(s)
    let row = await fresh(s, r.credential)
    expect(await runnerQueue(s.system, row)).toEqual([])
    await expect(claimRun(s.system, row, run.id, { idempotencyKey: 'c' })).rejects.toMatchObject({
      details: { code: 'capacity_exceeded', window: 'fiveHour', percent: 85, ceiling: 80 },
    })
    expect((await listRuns(s.ctx, s.project.id, run.taskId))[0]!.state).toBe('queued')

    await reportCapacity(s.system, row, usage(40, 10))
    row = await fresh(s, r.credential)
    expect(await runnerQueue(s.system, row)).toHaveLength(1)
    expect((await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })).run.fencingToken).toBe(
      1,
    )
  })

  it('does not stop work that is already running when usage crosses the ceiling', async () => {
    const s = await setup()
    const r = await enroll(s)
    const { run } = await queuedRun(s)
    const claim = await claimRun(s.system, r.row, run.id, { idempotencyKey: 'c' })
    await reportCapacity(s.system, r.row, usage(95, 10))
    const row = await fresh(s, r.credential)
    expect(await heartbeatRun(s.system, row, run.id, claim.run.fencingToken)).toHaveProperty(
      'leaseExpiresAt',
    )
  })

  it('applies a weekly ceiling too, and a ceiling of 100 lets everything through', async () => {
    const s = await setup()
    const r = await enroll(s)
    const { run } = await queuedRun(s)
    await reportCapacity(s.system, r.row, usage(10, 70))
    expect(await runnerQueue(s.system, await fresh(s, r.credential))).toEqual([])
    await updateRunner(s.ctx, r.runner.id, {
      ceilings: { claude_code: { fiveHour: 100, weekly: 100 } },
    })
    const row = await fresh(s, r.credential)
    expect(await runnerQueue(s.system, row)).toHaveLength(1)
    expect((await claimRun(s.system, row, run.id, { idempotencyKey: 'c' })).run.id).toBe(run.id)
  })

  it('treats a window that already reset as empty', async () => {
    const s = await setup()
    const r = await enroll(s)
    await queuedRun(s)
    await reportCapacity(s.system, r.row, usage(99, 10, '2026-10-20T02:00:00Z'))
    expect(await runnerQueue(s.system, await fresh(s, r.credential))).toHaveLength(1)
  })

  it("is per provider: another provider's usage doesn't block", async () => {
    const s = await setup()
    const r = await enroll(s, 'box', ['claude_code', 'codex'])
    await queuedRun(s)
    await reportCapacity(s.system, r.row, { ...usage(99, 99), provider: 'codex' })
    expect(await runnerQueue(s.system, await fresh(s, r.credential))).toHaveLength(1)
  })

  it('shows the reported usage and ceilings on the runner (AC-27)', async () => {
    const s = await setup()
    const r = await enroll(s)
    await reportCapacity(s.system, r.row, usage(34, 5))
    await updateRunner(s.ctx, r.runner.id, { ceilings: { codex: { fiveHour: 60, weekly: 50 } } })
    const [dto] = await listRunners(s.ctx)
    expect(dto!.capacity.claude_code).toMatchObject({
      fiveHour: { percent: 34, resetsAt: '2026-10-20T07:00:00Z' },
      weekly: { percent: 5 },
    })
    expect(dto!.ceilings.codex).toEqual({ fiveHour: 60, weekly: 50 })
  })

  async function limitHit(s: World, resetsAt?: string) {
    const r = await enroll(s)
    const { task, run } = await queuedRun(s)
    const claim = await claimRun(s.system, r.row, run.id, { idempotencyKey: 'c1' })
    await recordRunEvent(s.system, r.row, run.id, {
      eventId: 's',
      sequence: 1,
      type: 'session',
      payload: { sessionRef: 'sess-9' },
      fencingToken: claim.run.fencingToken,
    })
    await recordRunEvent(s.system, r.row, run.id, {
      eventId: 'cap',
      sequence: 2,
      type: 'capacity_wait',
      payload: resetsAt ? { resetsAt, window: 'fiveHour' } : {},
      fencingToken: claim.run.fencingToken,
    })
    return { r, task, run, token: claim.run.fencingToken }
  }

  it('pauses without failing, then resumes the same session once after the reset (AC-25)', async () => {
    const s = await setup()
    const { r, task, run, token } = await limitHit(s, '2026-10-20T08:00:00Z')
    const paused = await getTask(s.ctx, s.project.id, task.id)
    expect(paused.state).toBe('in_progress')
    expect(paused.run).toMatchObject({
      state: 'waiting_for_capacity',
      resumeAt: '2026-10-20T08:00:00.000Z',
    })
    // The stopped process can't report anything more.
    await expect(heartbeatRun(s.system, r.row, run.id, token)).rejects.toMatchObject({
      details: { code: 'stale_fencing' },
    })
    s.clock.advance(60 * 60_000)
    expect(await runnerQueue(s.system, r.row)).toEqual([])
    await expect(
      claimRun(s.system, r.row, run.id, { idempotencyKey: 'early' }),
    ).rejects.toMatchObject({
      details: { code: 'claim_conflict' },
    })

    s.clock.advance(5 * 60 * 60_000)
    expect(await runnerQueue(s.system, r.row)).toHaveLength(1)
    const results = await Promise.allSettled([
      claimRun(s.system, r.row, run.id, { idempotencyKey: 'resume-a' }),
      claimRun(s.system, r.row, run.id, { idempotencyKey: 'resume-b' }),
    ])
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const ok = (
      results.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof claimRun>>
      >
    ).value
    expect(ok.run.sessionRef).toBe('sess-9')
    expect(ok.run.fencingToken).toBeGreaterThan(token)
    const [saved] = await s.db.db.select().from(runs).where(eq(runs.id, run.id))
    expect(saved).toMatchObject({ state: 'running', capacityResumes: 1, resumeAt: null })
    expect((await getTask(s.ctx, s.project.id, task.id)).state).toBe('in_progress')
  })

  it('waits half an hour when the provider gives no reset time', async () => {
    const s = await setup()
    const { run } = await limitHit(s)
    const [saved] = await s.db.db.select().from(runs).where(eq(runs.id, run.id))
    expect(saved!.resumeAt!.getTime()).toBe(s.clock.now().getTime() + 30 * 60_000)
  })

  it('hands over to a person after repeated limit hits in one run', async () => {
    const s = await setup()
    const { r, task, run } = await limitHit(s, '2026-10-20T04:00:00Z')
    let seq = 3
    for (let i = 0; i < 3; i += 1) {
      s.clock.advance(2 * 60 * 60_000)
      const claim = await claimRun(s.system, r.row, run.id, { idempotencyKey: `r${i}` })
      await recordRunEvent(s.system, r.row, run.id, {
        eventId: `cap${i}`,
        sequence: seq++,
        type: 'capacity_wait',
        payload: { resetsAt: new Date(s.clock.now().getTime() + 3_600_000).toISOString() },
        fencingToken: claim.run.fencingToken,
      })
    }
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.run).toMatchObject({ state: 'interrupted' })
    expect(after.run?.failureReason).toMatch(/again and again/)
    expect(after.state).toBe('in_progress')
  })

  it('can be cancelled while waiting, and then never resumes', async () => {
    const s = await setup()
    const { r, task, run } = await limitHit(s, '2026-10-20T04:00:00Z')
    await cancelRun(s.ctx, s.project.id, run.id, 'No longer needed')
    expect((await getTask(s.ctx, s.project.id, task.id)).state).toBe('ready')
    s.clock.advance(5 * 3_600_000)
    expect(await runnerQueue(s.system, r.row)).toEqual([])
  })
})
