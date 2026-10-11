import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { taskArtifacts, taskEvents, taskSubmissions } from '../../src/db/schema'
import { acceptTask } from '../../src/services/acceptance.service'
import { getCellDetail } from '../../src/services/board.service'
import { updateProject } from '../../src/services/projects.service'
import { claimRun, completeRun, startRun } from '../../src/services/runs.service'
import { createTask, getTask, transitionTask } from '../../src/services/tasks.service'
import { getAttention } from '../../src/services/thread.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, createUser, makeCtx } from '../helpers/factories'
import type { WorkWorld } from '../helpers/work'
import { COMMIT, runningRun, SUBMISSION, workSetup } from '../helpers/work'

const getDb = useTestDatabase()
type Running = Awaited<ReturnType<typeof runningRun>>

const deliver = (s: WorkWorld, r: Running, submission: unknown = SUBMISSION, key = 'done-1') =>
  completeRun(s.system, r.row, r.run.id, {
    fencingToken: r.token,
    idempotencyKey: key,
    outcome: 'succeeded',
    summary: 'Implemented and tested',
    submission: submission as never,
  })

const accept = async (s: WorkWorld, r: Running, over: Record<string, unknown> = {}) => {
  const task = await getTask(s.ctx, s.project.id, r.task.id)
  const sub = task.submission!
  return acceptTask(s.ctx, s.project.id, r.task.id, {
    expectedVersion: task.version,
    submissionId: sub.id,
    headCommit: sub.headCommit,
    contextRevisionId: sub.contextRevisionId,
    idempotencyKey: 'acc-1',
    acknowledgeFailing: false,
    ...over,
  })
}

describe('what counts as a delivery', () => {
  it('refuses a "success" without evidence and leaves the run running (AC-10)', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await expect(
      completeRun(s.system, r.row, r.run.id, {
        fencingToken: r.token,
        idempotencyKey: 'x',
        outcome: 'succeeded',
        summary: 'Trust me',
      }),
    ).rejects.toMatchObject({ code: 'validation_error', details: { code: 'evidence_missing' } })
    await expect(deliver(s, r, { ...SUBMISSION, verification: [] }, 'y')).rejects.toMatchObject({
      details: { code: 'evidence_missing' },
    })
    const wrongCommit = {
      ...SUBMISSION,
      verification: [{ ...SUBMISSION.verification[0]!, commit: 'f'.repeat(40) }],
    }
    await expect(deliver(s, r, wrongCommit, 'z')).rejects.toMatchObject({
      details: { code: 'evidence_missing' },
    })
    const task = await getTask(s.ctx, s.project.id, r.task.id)
    expect(task.state).toBe('in_progress')
    expect(task.run).toMatchObject({ state: 'running' })
    expect(task.submission).toBeNull()
    expect(await s.db.db.select().from(taskSubmissions)).toHaveLength(0)
  })

  it('submits for acceptance, not done, with the evidence labelled (AC-11)', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await deliver(s, r)
    const task = await getTask(s.ctx, s.project.id, r.task.id)
    expect(task.state).toBe('ready_for_acceptance')
    expect(task.submission).toMatchObject({
      state: 'submitted',
      headCommit: COMMIT,
      runId: r.run.id,
      evidence: { onCommit: 1, passing: 1, failing: 0, strongest: 'runner_reported' },
    })
    expect(task.submission!.checks[0]).toMatchObject({
      command: 'pnpm test',
      source: 'runner_reported',
    })
    expect((await getCellDetail(s.ctx, s.project.id, s.cellId)).status).toBe('doing')
    const [item] = await getAttention(s.ctx, s.project.id)
    expect(item).toMatchObject({ kind: 'acceptance', taskTitle: 'Email login' })
    expect(item!.summary).toContain(COMMIT.slice(0, 7))
  })

  it('keeps deliveries inside what the project allows to leave the machine', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    const pr = {
      artifacts: [
        {
          kind: 'pull_request' as const,
          url: 'https://github.com/acme/clinic/pull/12',
          repo: 'acme/clinic',
          branch: 'stagegrid/task-1',
          headCommit: COMMIT,
        },
      ],
      verification: SUBMISSION.verification,
    }
    await expect(deliver(s, r, pr)).rejects.toMatchObject({
      details: {
        problems: expect.arrayContaining([
          "This project doesn't allow employees to open pull requests.",
        ]),
      },
    })
    await updateProject(s.ctx, s.project.id, {
      delivery: { mode: 'pull_request', repo: 'acme/clinic' },
    })
    await deliver(s, r, pr)
    expect((await getTask(s.ctx, s.project.id, r.task.id)).submission!.artifacts[0]).toMatchObject({
      kind: 'pull_request',
      url: 'https://github.com/acme/clinic/pull/12',
    })
  })

  it('only owners change what may leave the machine', async () => {
    const s = await workSetup(getDb)
    const editor = await createUser(s.db, { name: 'Ed' })
    await addMember(s.db, s.project.id, editor.userId, 'editor')
    await expect(
      updateProject(makeCtx(s.db, editor, s.clock.now), s.project.id, {
        delivery: { mode: 'branch', repo: 'a/b' },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const updated = await updateProject(s.ctx, s.project.id, {
      delivery: { mode: 'branch', repo: 'a/b' },
    })
    expect(updated.delivery).toEqual({ mode: 'branch', repo: 'a/b' })
  })
})

describe('retried delivery (AC-17)', () => {
  it('does not duplicate the submission, the message or the artifact', async () => {
    const s = await workSetup(getDb)
    await updateProject(s.ctx, s.project.id, {
      delivery: { mode: 'pull_request', repo: 'acme/clinic' },
    })
    const r = await runningRun(s)
    const pr = {
      artifacts: [
        {
          kind: 'pull_request' as const,
          url: 'https://github.com/acme/clinic/pull/12',
          repo: 'acme/clinic',
          branch: 'b',
          headCommit: COMMIT,
        },
      ],
      verification: SUBMISSION.verification,
    }
    await deliver(s, r, pr, 'same-key')
    await deliver(s, r, pr, 'same-key')
    expect(await s.db.db.select().from(taskSubmissions)).toHaveLength(1)
    const events = await s.db.db.select().from(taskEvents).where(eq(taskEvents.taskId, r.task.id))
    expect(events.filter((e) => e.action === 'run_succeeded')).toHaveLength(1)

    // A rework run that updates the same pull request reuses the artifact.
    const task = await getTask(s.ctx, s.project.id, r.task.id)
    const changes = await transitionTask(s.ctx, s.project.id, r.task.id, {
      action: 'request_changes',
      expectedVersion: task.version,
      reason: 'Handle lockout',
    })
    const rework = await startRun(s.ctx, s.project.id, r.task.id, {
      expectedVersion: changes.version,
      contextRevisionId: task.context!.revisionId,
      idempotencyKey: 'rework',
    })
    const claim = await claimRun(s.system, r.row, rework.id, { idempotencyKey: 'c2' })
    const newCommit = 'b'.repeat(40)
    await completeRun(s.system, r.row, rework.id, {
      fencingToken: claim.run.fencingToken,
      idempotencyKey: 'd2',
      outcome: 'succeeded',
      submission: {
        artifacts: [{ ...pr.artifacts[0]!, headCommit: newCommit }],
        verification: [{ ...SUBMISSION.verification[0]!, commit: newCommit }],
      },
    })
    expect(await s.db.db.select().from(taskArtifacts)).toHaveLength(1)
    expect(await s.db.db.select().from(taskSubmissions)).toHaveLength(2)
  })
})

describe('accepting (AC-12)', () => {
  it('finishes the task on the exact commit and context, and the cell follows', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await deliver(s, r)
    const done = await accept(s, r)
    expect(done.state).toBe('done')
    expect(done.submission).toMatchObject({
      state: 'accepted',
      decidedBy: 'Pond',
      headCommit: COMMIT,
    })
    expect((await getCellDetail(s.ctx, s.project.id, s.cellId)).status).toBe('done')
    const [row] = await s.db.db.select().from(taskSubmissions)
    expect(row).toMatchObject({ acceptedCommit: COMMIT, acceptKey: 'acc-1' })
    expect(await getAttention(s.ctx, s.project.id)).toEqual([])
  })

  it('repeats safely and only once', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await deliver(s, r)
    const sub = (await getTask(s.ctx, s.project.id, r.task.id)).submission!
    const first = await accept(s, r)
    const again = await acceptTask(s.ctx, s.project.id, r.task.id, {
      expectedVersion: 1,
      submissionId: sub.id,
      headCommit: sub.headCommit,
      contextRevisionId: sub.contextRevisionId,
      idempotencyKey: 'acc-1',
      acknowledgeFailing: false,
    })
    expect(again.version).toBe(first.version)
    const events = await s.db.db.select().from(taskEvents).where(eq(taskEvents.taskId, r.task.id))
    expect(events.filter((e) => e.action === 'accept')).toHaveLength(1)
    await expect(
      acceptTask(s.ctx, s.project.id, r.task.id, {
        expectedVersion: 1,
        submissionId: sub.id,
        headCommit: sub.headCommit,
        contextRevisionId: sub.contextRevisionId,
        idempotencyKey: 'other',
        acknowledgeFailing: false,
      }),
    ).rejects.toMatchObject({ details: { code: 'submission_closed' } })
  })

  it('refuses a commit or context other than the one reviewed, and a stale task', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await deliver(s, r)
    await expect(accept(s, r, { headCommit: 'c'.repeat(40) })).rejects.toMatchObject({
      details: { code: 'commit_changed' },
    })
    await expect(
      accept(s, r, { contextRevisionId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ details: { code: 'context_changed' } })
    await expect(accept(s, r, { expectedVersion: 99 })).rejects.toMatchObject({
      details: { code: 'stale_version' },
    })
    expect((await getTask(s.ctx, s.project.id, r.task.id)).state).toBe('ready_for_acceptance')
  })

  it('needs an editor on the project; employees never accept their own work', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await deliver(s, r)
    const sub = (await getTask(s.ctx, s.project.id, r.task.id)).submission!
    const body = {
      expectedVersion: 1,
      submissionId: sub.id,
      headCommit: sub.headCommit,
      contextRevisionId: sub.contextRevisionId,
      idempotencyKey: 'k',
      acknowledgeFailing: false,
    }
    const viewer = await createUser(s.db, { name: 'Vi' })
    await addMember(s.db, s.project.id, viewer.userId, 'viewer')
    await expect(
      acceptTask(makeCtx(s.db, viewer, s.clock.now), s.project.id, r.task.id, body),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const outsider = await createUser(s.db, { name: 'Out' })
    await expect(
      acceptTask(makeCtx(s.db, outsider, s.clock.now), s.project.id, r.task.id, body),
    ).rejects.toMatchObject({ code: 'not_found' })
    // No runner credential can accept: acceptance is a project-member action with no runner path.
    await expect(
      transitionTask(s.ctx, s.project.id, r.task.id, { action: 'accept', expectedVersion: 99 }),
    ).rejects.toMatchObject({ details: { code: 'employee_task' } })
    expect((await getTask(s.ctx, s.project.id, r.task.id)).state).toBe('ready_for_acceptance')
  })

  it('asks for confirmation when a check failed on the commit', async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await deliver(s, r, {
      ...SUBMISSION,
      verification: [
        ...SUBMISSION.verification,
        { ...SUBMISSION.verification[0]!, command: 'pnpm lint', exitCode: 1 },
      ],
    })
    await expect(accept(s, r)).rejects.toMatchObject({
      details: { code: 'evidence_failing', failing: 1 },
    })
    const done = await accept(s, r, { acknowledgeFailing: true })
    expect(done.state).toBe('done')
  })

  it("a newer delivery replaces the old one, so an old acceptance can't cover the new commit (AC-18)", async () => {
    const s = await workSetup(getDb)
    const r = await runningRun(s)
    await deliver(s, r)
    const task = await getTask(s.ctx, s.project.id, r.task.id)
    const old = task.submission!
    const changes = await transitionTask(s.ctx, s.project.id, r.task.id, {
      action: 'request_changes',
      expectedVersion: task.version,
      reason: 'More tests',
    })
    expect((await getTask(s.ctx, s.project.id, r.task.id)).submission).toMatchObject({
      state: 'changes_requested',
      decisionReason: 'More tests',
    })
    const rework = await startRun(s.ctx, s.project.id, r.task.id, {
      expectedVersion: changes.version,
      contextRevisionId: old.contextRevisionId,
      idempotencyKey: 'rework',
    })
    const claim = await claimRun(s.system, r.row, rework.id, { idempotencyKey: 'c2' })
    const newCommit = 'b'.repeat(40)
    await completeRun(s.system, r.row, rework.id, {
      fencingToken: claim.run.fencingToken,
      idempotencyKey: 'd2',
      outcome: 'succeeded',
      submission: {
        artifacts: [{ ...SUBMISSION.artifacts[0]!, headCommit: newCommit }],
        verification: [{ ...SUBMISSION.verification[0]!, commit: newCommit }],
      },
    })
    const latest = (await getTask(s.ctx, s.project.id, r.task.id)).submission!
    expect(latest.headCommit).toBe(newCommit)
    // Accepting what was reviewed before is refused: it isn't the delivery that is waiting now.
    await expect(
      acceptTask(s.ctx, s.project.id, r.task.id, {
        expectedVersion: (await getTask(s.ctx, s.project.id, r.task.id)).version,
        submissionId: old.id,
        headCommit: old.headCommit,
        contextRevisionId: old.contextRevisionId,
        idempotencyKey: 'old',
        acknowledgeFailing: false,
      }),
    ).rejects.toMatchObject({
      details: { code: expect.stringMatching(/submission_(changed|closed)/) },
    })
    // Accepting with the old commit against the new submission is refused too.
    await expect(accept(s, r, { headCommit: old.headCommit })).rejects.toMatchObject({
      details: { code: 'commit_changed' },
    })
    expect((await accept(s, r)).state).toBe('done')
  })
})

describe('people-owned tasks are unchanged', () => {
  it('still accept with the plain action and need no submission', async () => {
    const s = await workSetup(getDb)
    const t = await createTask(s.ctx, s.project.id, {
      cellId: s.cellId,
      title: 'By hand',
      scope: '',
      acceptanceCriteria: [],
      required: true,
      ownerUserId: null,
      employeeId: null,
    })
    let version = t.version
    for (const action of ['mark_ready', 'start', 'submit', 'accept'] as const) {
      const next = await transitionTask(s.ctx, s.project.id, t.id, {
        action,
        expectedVersion: version,
      })
      version = next.version
    }
    const done = await getTask(s.ctx, s.project.id, t.id)
    expect(done).toMatchObject({ state: 'done', submission: null })
    expect(done.actions).toEqual(['reopen'])
  })
})
