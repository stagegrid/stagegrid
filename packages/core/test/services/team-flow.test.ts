import { DEFAULT_TEAM, type TeamSettings } from '@stagegrid/shared'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { cells, documentApprovals, runs, taskContextRevisions, tasks } from '../../src/db/schema'
import { acceptTask } from '../../src/services/acceptance.service'
import { getBoard, getCellDetail } from '../../src/services/board.service'
import { applyChanges } from '../../src/services/changes.service'
import { createEmployee } from '../../src/services/employees.service'
import { claimRun, completeRun, runnerQueue, startRun } from '../../src/services/runs.service'
import { setCellProgressMode } from '../../src/services/tasks.service'
import { createTask, getTask, pinContext, transitionTask } from '../../src/services/tasks.service'
import { updateTeam } from '../../src/services/team.service'
import { getAttention, getThread } from '../../src/services/thread.service'
import { useTestDatabase } from '../helpers/db'
import { enrollRunnerFor, workSetup } from '../helpers/work'

const getDb = useTestDatabase()

const sha = (c: string) => c.repeat(40)
const delivery = (commit: string) => ({
  artifacts: [{ kind: 'commit' as const, url: null, repo: null, branch: null, headCommit: commit }],
  verification: [
    { command: 'pnpm test', exitCode: 0, commit, source: 'runner_reported' as const, output: null },
  ],
})

async function teamWorld(
  over: Partial<TeamSettings> = {},
  opts: { qaOn?: boolean; reviewerOn?: boolean } = {},
) {
  const s = await workSetup(getDb)
  const mk = (
    displayName: string,
    role: 'analyst' | 'reviewer' | 'qa',
    provider: 'claude_code' | 'codex',
  ) =>
    createEmployee(s.ctx, s.project.id, {
      displayName,
      role,
      provider,
      model: null,
      instructions: '',
      avatar: null,
    })
  const nok = await mk('Nok', 'analyst', 'claude_code')
  const ploy = await mk('Ploy', 'reviewer', 'codex')
  const beam = await mk('Beam', 'qa', 'claude_code')
  const reviewerOn = opts.reviewerOn ?? true
  const qaOn = opts.qaOn ?? true
  await updateTeam(s.ctx, s.project.id, {
    ...DEFAULT_TEAM,
    analyst: { enabled: true, employeeId: nok.id, stageId: null },
    dev: { employeeId: s.mali.id, stageId: null },
    reviewer: { enabled: reviewerOn, employeeId: reviewerOn ? ploy.id : null },
    qa: { enabled: qaOn, employeeId: qaOn ? beam.id : null, stageId: null },
    ...over,
  })
  const runner = await enrollRunnerFor(s, 'box', ['claude_code', 'codex'])
  const board = await getBoard(s.ctx, s.project.id)
  const item = board.items[0]!
  const cellOf = (stage: string) =>
    board.cells[item.id]![board.stages.find((x) => x.name === stage)!.id]!.id
  return { s, nok, ploy, beam, runner, cellOf }
}
type World = Awaited<ReturnType<typeof teamWorld>>

/** Drives a person's side and a runner's side of one run, the way the real pieces would. */
async function work(
  w: World,
  taskId: string,
  complete: Record<string, unknown>,
  opts: { start?: boolean } = {},
) {
  const { s } = w
  let task = await getTask(s.ctx, s.project.id, taskId)
  if (opts.start !== false) {
    if (task.state === 'draft')
      task = await transitionTask(s.ctx, s.project.id, taskId, {
        action: 'mark_ready',
        expectedVersion: task.version,
      })
    await startRun(s.ctx, s.project.id, taskId, {
      expectedVersion: task.version,
      contextRevisionId: task.context!.revisionId,
      idempotencyKey: `start-${Math.random()}`,
    })
  }
  return runNext(w, complete)
}

/** Claims whatever run is queued next and completes it. */
async function runNext(w: World, complete: Record<string, unknown>) {
  const { s, runner } = w
  const [q] = await runnerQueue(s.system, runner.row)
  expect(q, 'a run should be waiting').toBeDefined()
  const claim = await claimRun(s.system, runner.row, q!.id, {
    idempotencyKey: `c-${Math.random()}`,
  })
  await completeRun(s.system, runner.row, q!.id, {
    fencingToken: claim.run.fencingToken,
    idempotencyKey: `d-${Math.random()}`,
    outcome: 'succeeded',
    ...complete,
  } as never)
  return claim
}

const accept = async (w: World, taskId: string) => {
  const task = await getTask(w.s.ctx, w.s.project.id, taskId)
  const sub = task.submission!
  return acceptTask(w.s.ctx, w.s.project.id, taskId, {
    expectedVersion: task.version,
    submissionId: sub.id,
    headCommit: sub.headCommit,
    contextRevisionId: sub.contextRevisionId,
    idempotencyKey: `acc-${sub.id}`,
    acknowledgeFailing: false,
  })
}

const newTask = async (
  w: World,
  cell: string,
  title: string,
  employeeId: string,
  decisions = ['Email and password only'],
) => {
  await setCellProgressMode(w.s.ctx, w.s.project.id, cell, 'tasks')
  const t = await createTask(w.s.ctx, w.s.project.id, {
    cellId: cell,
    title,
    scope: 'Sign in',
    acceptanceCriteria: ['Wrong password is rejected'],
    required: true,
    ownerUserId: null,
    employeeId,
  })
  await pinContext(w.s.ctx, w.s.project.id, t.id, { documentIds: [], sources: [], decisions })
  return t
}

const allTasks = (w: World) => w.s.db.db.select().from(tasks)
const tasksOf = async (w: World, role: 'analyst' | 'dev' | 'qa') =>
  (await allTasks(w)).filter((t) => t.role === role)

describe('the team workflow end to end', () => {
  it('goes Analyst -> approval -> Dev -> Reviewer (one round) -> acceptance -> QA (one failure) -> acceptance', async () => {
    const w = await teamWorld()
    const { s } = w

    // Analyst drafts the requirements; a person's acceptance approves that exact revision.
    const analystTask = await newTask(w, w.cellOf('Document'), 'Requirements: Login', w.nok.id)
    expect(analystTask.role).toBe('analyst')
    const claim = await work(w, analystTask.id, {
      summary: 'Drafted the SRS',
      documents: [
        { template: 'srs', sections: [{ id: '1.1', content: 'Sign in with email and password' }] },
      ],
    })
    expect(claim.role).toBe('analyst')
    expect(claim.analyst!.templates[0]).toMatchObject({ key: 'srs' })
    expect(claim.analyst!.templates[0]!.sections.length).toBeGreaterThan(3)
    const a = await getTask(s.ctx, s.project.id, analystTask.id)
    expect(a.state).toBe('ready_for_acceptance')
    expect(a.submission!.artifacts[0]).toMatchObject({ kind: 'document', version: 1 })
    expect(await tasksOf(w, 'dev')).toHaveLength(0)

    await accept(w, analystTask.id)
    const [approval] = await s.db.db.select().from(documentApprovals)
    expect(approval).toMatchObject({ version: 1 })
    const [devRow] = await tasksOf(w, 'dev')
    expect(devRow).toMatchObject({
      state: 'draft',
      employeeId: s.mali.id,
      parentTaskId: analystTask.id,
    })
    // The Implement cell now follows its tasks, and the Dev task carries the approved revision.
    const [implementCell] = await s.db.db.select().from(cells).where(eq(cells.id, devRow!.cellId))
    expect(implementCell!.progressMode).toBe('tasks')
    let dev = await getTask(s.ctx, s.project.id, devRow!.id)
    expect(dev.context).toBeTruthy()
    dev = await transitionTask(s.ctx, s.project.id, dev.id, {
      action: 'mark_ready',
      expectedVersion: dev.version,
    })
    expect(dev.state).toBe('ready')

    // Dev delivers; the Reviewer is queued by itself and asks for changes.
    const c1 = sha('a')
    await work(w, dev.id, { summary: 'Built it', submission: delivery(c1) }, { start: true })
    dev = await getTask(s.ctx, s.project.id, dev.id)
    expect(dev.state).toBe('in_progress')
    expect(dev.submission).toMatchObject({ reviewState: 'pending', headCommit: c1 })
    const review1 = await runNext(w, {
      review: {
        verdict: 'changes_requested',
        summary: 'Lockout is missing',
        findings: [
          { severity: 'major', text: 'No lockout after 5 attempts', file: 'src/login.ts' },
        ],
      },
    })
    expect(review1).toMatchObject({ role: 'reviewer', checkout: c1 })
    expect(review1.examine!.headCommit).toBe(c1)
    dev = await getTask(s.ctx, s.project.id, dev.id)
    expect(dev).toMatchObject({ state: 'changes_requested', reworkRounds: 1 })
    expect(dev.submission).toMatchObject({
      state: 'changes_requested',
      reviewState: 'changes_requested',
    })

    // Dev gets a new round on the same task, with the finding; the Reviewer re-reviews the new commit.
    const c2 = sha('b')
    const rework = await runNext(w, { summary: 'Added lockout', submission: delivery(c2) })
    expect(rework.role).toBe('dev')
    expect(rework.feedback[0]).toMatchObject({ source: 'reviewer', summary: 'Lockout is missing' })
    expect(rework.feedback[0]!.findings[0]).toMatchObject({
      text: 'No lockout after 5 attempts',
      file: 'src/login.ts',
    })
    const review2 = await runNext(w, {
      review: { verdict: 'pass', summary: 'Looks good', findings: [] },
    })
    expect(review2.checkout).toBe(c2)
    dev = await getTask(s.ctx, s.project.id, dev.id)
    expect(dev.state).toBe('ready_for_acceptance')
    expect(dev.submission).toMatchObject({ headCommit: c2, reviewState: 'passed' })
    expect(dev.submission!.reviews.map((r) => r.verdict)).toEqual(['pass'])

    // Accepting the Implement task creates exactly one QA task, even when acceptance is retried (AC-24).
    await accept(w, dev.id)
    const sub = (await getTask(s.ctx, s.project.id, dev.id)).submission!
    await acceptTask(s.ctx, s.project.id, dev.id, {
      expectedVersion: 1,
      submissionId: sub.id,
      headCommit: sub.headCommit,
      contextRevisionId: sub.contextRevisionId,
      idempotencyKey: `acc-${sub.id}`,
      acknowledgeFailing: false,
    })
    expect(await tasksOf(w, 'qa')).toHaveLength(1)
    const [qaRow] = await tasksOf(w, 'qa')
    expect(qaRow).toMatchObject({ state: 'draft', employeeId: w.beam.id, parentTaskId: dev.id })

    // QA fails the accepted commit: Implement reopens as a rework round; QA waits for the new commit (AC-21).
    const qaClaim = await work(w, qaRow!.id, {
      summary: 'Password reset is broken',
      qa: {
        verdict: 'fail',
        summary: 'Password reset is broken',
        findings: [{ severity: 'blocker', text: 'Reset email never arrives', file: null }],
        results: [
          {
            criterion: 'Wrong password is rejected',
            result: 'pass',
            evidence: 'tried 3 passwords',
          },
        ],
      },
    })
    expect(qaClaim).toMatchObject({ role: 'qa', checkout: c2 })
    dev = await getTask(s.ctx, s.project.id, dev.id)
    expect(dev).toMatchObject({ state: 'changes_requested', reworkRounds: 2 })
    const qa = await getTask(s.ctx, s.project.id, qaRow!.id)
    expect(qa).toMatchObject({
      state: 'draft',
      blockedReason: 'Waiting for the new accepted commit',
    })
    expect((await getCellDetail(s.ctx, s.project.id, dev.cellId)).status).toBe('doing')

    const c3 = sha('c')
    const rework2 = await runNext(w, { summary: 'Fixed reset', submission: delivery(c3) })
    expect(rework2.feedback[0]).toMatchObject({ source: 'qa' })
    expect(rework2.feedback[0]!.findings.map((f) => f.text)).toContain('Reset email never arrives')
    await runNext(w, { review: { verdict: 'pass', summary: 'ok', findings: [] } })
    await accept(w, dev.id)
    // The same QA task is re-armed with the new commit; there is still only one.
    expect(await tasksOf(w, 'qa')).toHaveLength(1)
    const rearmed = await getTask(s.ctx, s.project.id, qaRow!.id)
    expect(rearmed.blockedReason).toBeNull()
    const qaContexts = await s.db.db
      .select()
      .from(taskContextRevisions)
      .where(eq(taskContextRevisions.taskId, qaRow!.id))
    expect(
      qaContexts.at(-1)!.manifest.sources.find((x) => x.title === 'Accepted delivery')!.content,
    ).toContain(c3)

    // QA passes the new commit and a person accepts: the item is finished.
    await work(w, qaRow!.id, {
      summary: 'All good',
      qa: {
        verdict: 'pass',
        summary: 'All good',
        findings: [],
        results: [{ criterion: 'Wrong password is rejected', result: 'pass', evidence: 'ok' }],
      },
    })
    await accept(w, qaRow!.id)
    expect((await getTask(s.ctx, s.project.id, qaRow!.id)).state).toBe('done')
    expect((await getCellDetail(s.ctx, s.project.id, dev.cellId)).status).toBe('done')
    expect((await getCellDetail(s.ctx, s.project.id, qaRow!.cellId)).status).toBe('done')

    const thread = await getThread(s.ctx, s.project.id, dev.id)
    expect(thread.filter((t) => t.kind === 'review').map((t) => t.text)).toEqual([
      'Review: changes requested. Lockout is missing',
      'Review: passed. Looks good',
      'Review: passed. ok',
    ])
  })
})

describe('limits and switches', () => {
  it('stops at the rework limit and raises it for a person (AC-22)', async () => {
    const w = await teamWorld({ reworkLimit: 1 })
    const { s } = w
    const dev = await newTask(w, w.cellOf('Implement'), 'Build login', s.mali.id)
    await work(w, dev.id, { summary: 'v1', submission: delivery(sha('a')) })
    const changes = {
      review: { verdict: 'changes_requested' as const, summary: 'Needs work', findings: [] },
    }
    await runNext(w, changes)
    expect((await getTask(s.ctx, s.project.id, dev.id)).reworkRounds).toBe(1)
    await runNext(w, { summary: 'v2', submission: delivery(sha('b')) })
    await runNext(w, changes)
    const after = await getTask(s.ctx, s.project.id, dev.id)
    expect(after).toMatchObject({ state: 'changes_requested', reworkRounds: 1 })
    expect(after.blockedReason).toContain('Rework limit reached (1 round)')
    expect(await runnerQueue(s.system, w.runner.row)).toEqual([])
    expect(await getAttention(s.ctx, s.project.id)).toEqual([
      expect.objectContaining({ kind: 'rework_limit', taskTitle: 'Build login' }),
    ])
  })

  it('goes straight to human acceptance with Reviewer and QA off (AC-23)', async () => {
    const w = await teamWorld(
      { analyst: { enabled: false, employeeId: null, stageId: null } },
      { reviewerOn: false, qaOn: false },
    )
    const { s } = w
    const dev = await newTask(w, w.cellOf('Implement'), 'Build login', s.mali.id)
    await work(w, dev.id, { summary: 'Built', submission: delivery(sha('a')) })
    const task = await getTask(s.ctx, s.project.id, dev.id)
    expect(task).toMatchObject({ state: 'ready_for_acceptance' })
    expect(task.submission).toMatchObject({ reviewState: 'none' })
    expect(await runnerQueue(s.system, w.runner.row)).toEqual([])
    await accept(w, dev.id)
    expect((await getTask(s.ctx, s.project.id, dev.id)).state).toBe('done')
    expect(await tasksOf(w, 'qa')).toHaveLength(0)
    expect((await s.db.db.select().from(runs)).every((r) => r.role === 'dev')).toBe(true)
  })

  it("won't make the next task when the stage was already set by hand, and says so", async () => {
    const w = await teamWorld()
    const { s } = w
    await applyChanges(s.ctx, s.project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'QA', status: 'doing' }],
    })
    const dev = await newTask(w, w.cellOf('Implement'), 'Build login', s.mali.id)
    await work(w, dev.id, { summary: 'v1', submission: delivery(sha('a')) })
    await runNext(w, { review: { verdict: 'pass', summary: 'ok', findings: [] } })
    await accept(w, dev.id)
    expect(await tasksOf(w, 'qa')).toHaveLength(0)
    const [item] = await getAttention(s.ctx, s.project.id)
    expect(item).toMatchObject({ kind: 'handoff_blocked' })
    expect(item!.summary).toContain('already set to doing')
    const [qaCell] = await s.db.db
      .select()
      .from(cells)
      .where(eq(cells.id, w.cellOf('QA')))
    expect(qaCell!.progressMode).toBe('manual')
  })

  it('keeps Reviewer and Dev apart, and a reviewer off any task of their own', async () => {
    const w = await teamWorld()
    await expect(
      createTask(w.s.ctx, w.s.project.id, {
        cellId: w.cellOf('Implement'),
        title: 'x',
        scope: '',
        acceptanceCriteria: [],
        required: true,
        ownerUserId: null,
        employeeId: w.ploy.id,
      }),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('refuses a review or QA verdict that is missing, and a run with the wrong role payload', async () => {
    const w = await teamWorld()
    const { s } = w
    const dev = await newTask(w, w.cellOf('Implement'), 'Build login', s.mali.id)
    await work(w, dev.id, { summary: 'v1', submission: delivery(sha('a')) })
    const [q] = await runnerQueue(s.system, w.runner.row)
    const claim = await claimRun(s.system, w.runner.row, q!.id, { idempotencyKey: 'c' })
    await expect(
      completeRun(s.system, w.runner.row, q!.id, {
        fencingToken: claim.run.fencingToken,
        idempotencyKey: 'x',
        outcome: 'succeeded',
        submission: delivery(sha('a')),
      }),
    ).rejects.toMatchObject({ details: { code: 'evidence_missing' } })
  })
})

void and
