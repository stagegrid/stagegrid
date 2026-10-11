import type { RunDto } from '@stagegrid/shared'

import { getBoard } from '../../src/services/board.service'
import { createEmployee } from '../../src/services/employees.service'
import {
  authenticateRunner,
  createEnrollment,
  enrollRunner,
} from '../../src/services/runners.service'
import { claimRun, startRun } from '../../src/services/runs.service'
import {
  createTask,
  pinContext,
  setCellProgressMode,
  transitionTask,
} from '../../src/services/tasks.service'
import type { useTestDatabase } from './db'
import { createUser, FIXED_NOW, makeCtx, seedProject } from './factories'

/** A project with one task-managed cell, an employee (Mali, Claude Code) and a controllable clock. */
export async function workSetup(getDb: ReturnType<typeof useTestDatabase>) {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true, name: 'Pond' })
  const project = await seedProject(db, admin, { tree: [{ name: 'Login' }] })
  let t = FIXED_NOW.getTime()
  const clock = { now: () => new Date(t), advance: (ms: number) => void (t += ms) }
  const ctx = makeCtx(db, admin, clock.now)
  const system = makeCtx(db, null, clock.now)
  const board = await getBoard(ctx, project.id)
  const stage = board.stages.find((s) => s.name === 'Implement')!
  const cellId = board.cells[board.items[0]!.id]![stage.id]!.id
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
export type WorkWorld = Awaited<ReturnType<typeof workSetup>>

export async function enrollRunnerFor(
  s: WorkWorld,
  name = 'build-box',
  providers = ['claude_code'],
  projectIds?: string[],
) {
  const e = await createEnrollment(s.ctx, { name, projectIds: projectIds ?? [s.project.id] })
  const { credential, runner } = await enrollRunner(s.system, { token: e.token, providers })
  const row = (await authenticateRunner(s.db.db, s.ctx.config, credential, s.clock.now()))!
  return { credential, runner, row }
}

export async function readyEmployeeTask(s: WorkWorld, title = 'Email login') {
  const t = await createTask(s.ctx, s.project.id, {
    cellId: s.cellId,
    title,
    scope: 'Sign in with email',
    acceptanceCriteria: ['Wrong password is rejected'],
    required: true,
    ownerUserId: null,
    employeeId: s.mali.id,
  })
  const pinned = await pinContext(s.ctx, s.project.id, t.id, {
    documentIds: [],
    sources: [],
    decisions: ['Email and password only'],
  })
  const task = await transitionTask(s.ctx, s.project.id, t.id, {
    action: 'mark_ready',
    expectedVersion: t.version,
  })
  return { task, contextRevisionId: pinned.revisionId }
}

/** A run that a runner has claimed and is working on. */
export async function runningRun(s: WorkWorld) {
  const r = await enrollRunnerFor(s)
  const { task, contextRevisionId } = await readyEmployeeTask(s)
  const run: RunDto = await startRun(s.ctx, s.project.id, task.id, {
    expectedVersion: task.version,
    contextRevisionId,
    idempotencyKey: 'k1',
  })
  const claim = await claimRun(s.system, r.row, run.id, { idempotencyKey: 'c1' })
  return { ...r, task, run, contextRevisionId, token: claim.run.fencingToken }
}
