import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { auditLog, cellEvents } from '../../src/db/schema'
import { getBoard, getCellDetail } from '../../src/services/board.service'
import { applyChanges } from '../../src/services/changes.service'
import { editEvent } from '../../src/services/events.service'
import {
  createTask,
  getTask,
  listTasks,
  setCellProgressMode,
  transitionTask,
  updateTask,
} from '../../src/services/tasks.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, createUser, makeCtx, seedProject } from '../helpers/factories'
import { captureEvents } from '../helpers/listen'

const getDb = useTestDatabase()

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true, name: 'Pond' })
  const project = await seedProject(db, admin, { tree: [{ name: 'Login' }, { name: 'Settings' }] })
  const ctx = makeCtx(db, admin)
  const board = await getBoard(ctx, project.id)
  const item = board.items.find((i) => i.name === 'Login')!
  const stage = board.stages.find((s) => s.name === 'Implement')!
  const cellId = board.cells[item.id]![stage.id]!.id
  return { db, admin, ctx, project, cellId, board, item, stage }
}

async function taskCell() {
  const s = await setup()
  await setCellProgressMode(s.ctx, s.project.id, s.cellId, 'tasks')
  return s
}

const statusOf = async (s: Awaited<ReturnType<typeof setup>>) =>
  (await getCellDetail(s.ctx, s.project.id, s.cellId)).status

async function runToDone(s: Awaited<ReturnType<typeof setup>>, taskId: string) {
  let v = (await getTask(s.ctx, s.project.id, taskId)).version
  for (const action of ['mark_ready', 'start', 'submit', 'accept'] as const) {
    const t = await transitionTask(s.ctx, s.project.id, taskId, { action, expectedVersion: v })
    v = t.version
  }
}

const newTask = (s: Awaited<ReturnType<typeof setup>>, title: string, extra = {}) =>
  createTask(s.ctx, s.project.id, {
    cellId: s.cellId,
    title,
    scope: '',
    acceptanceCriteria: [],
    required: true,
    ownerUserId: null,
    ...extra,
  })

describe('cell progress mode', () => {
  it('leaves cells manual by default and keeps manual workflows working (AC-15)', async () => {
    const s = await setup()
    const detail = await getCellDetail(s.ctx, s.project.id, s.cellId)
    expect(detail.progressMode).toBe('manual')
    const res = await applyChanges(s.ctx, s.project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'Implement', status: 'doing' }],
    })
    expect(res.applied).toBe(1)
    expect(await statusOf(s)).toBe('doing')
  })

  it('refuses tasks on a manual cell', async () => {
    const s = await setup()
    await expect(newTask(s, 'Build it')).rejects.toMatchObject({ code: 'conflict' })
  })

  it('does not reopen a finished cell when it is switched to tasks with no tasks yet', async () => {
    const s = await setup()
    await applyChanges(s.ctx, s.project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'Implement', status: 'done' }],
    })
    await setCellProgressMode(s.ctx, s.project.id, s.cellId, 'tasks')
    expect(await statusOf(s)).toBe('done')
  })

  it('refuses a skipped cell', async () => {
    const s = await setup()
    await applyChanges(s.ctx, s.project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'Implement', status: 'skip' }],
    })
    await expect(setCellProgressMode(s.ctx, s.project.id, s.cellId, 'tasks')).rejects.toMatchObject(
      { code: 'conflict' },
    )
  })

  it('only an owner can switch back to manual, and it is audited', async () => {
    const s = await taskCell()
    const editor = await createUser(s.db, { name: 'Ed' })
    await addMember(s.db, s.project.id, editor.userId, 'editor')
    await expect(
      setCellProgressMode(makeCtx(s.db, editor), s.project.id, s.cellId, 'manual'),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await setCellProgressMode(s.ctx, s.project.id, s.cellId, 'manual')
    const log = await s.db.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'cell.progress_mode'))
    expect(log).toHaveLength(2)
  })
})

describe('task-managed cells', () => {
  it('rejects direct status writes with a conflict (AC-15)', async () => {
    const s = await taskCell()
    await expect(
      applyChanges(s.ctx, s.project.id, {
        dryRun: false,
        changes: [{ item: 'Login', stage: 'Implement', status: 'done' }],
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    // Detail edits on the same cell still work.
    const res = await applyChanges(s.ctx, s.project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'Implement', comment: 'note' }],
    })
    expect(res.applied).toBe(1)
  })

  it('rejects history edits', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'Build it')
    await runToDone(s, t.id)
    const detail = await getCellDetail(s.ctx, s.project.id, s.cellId)
    await expect(
      editEvent(s.ctx, s.project.id, detail.events[0]!.id, { delete: true }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('is todo with no tasks, doing when one of two is accepted, done when both are (AC-13)', async () => {
    const s = await taskCell()
    const a = await newTask(s, 'API')
    const b = await newTask(s, 'UI')
    expect(await statusOf(s)).toBe('todo')
    await runToDone(s, a.id)
    expect(await statusOf(s)).toBe('doing')
    await runToDone(s, b.id)
    expect(await statusOf(s)).toBe('done')
  })

  it('goes back to doing with a retained reason when an accepted task is reopened (AC-14)', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    await runToDone(s, t.id)
    expect(await statusOf(s)).toBe('done')
    const done = await getTask(s.ctx, s.project.id, t.id)
    await expect(
      transitionTask(s.ctx, s.project.id, t.id, {
        action: 'reopen',
        expectedVersion: done.version,
      }),
    ).rejects.toMatchObject({ code: 'validation_error' })
    const reopened = await transitionTask(s.ctx, s.project.id, t.id, {
      action: 'reopen',
      expectedVersion: done.version,
      reason: 'Missing validation',
    })
    expect(reopened.state).toBe('changes_requested')
    const detail = await getCellDetail(s.ctx, s.project.id, s.cellId)
    expect(detail.status).toBe('doing')
    expect(detail.rework).toBe(1)
    expect(detail.events[0]!.reason).toContain('Missing validation')
    expect(reopened.events.at(-1)).toMatchObject({ action: 'reopen', reason: 'Missing validation' })
  })

  it('ignores cancelled and optional tasks, and cancelling the last required one returns to todo', async () => {
    const s = await taskCell()
    const req = await newTask(s, 'Required')
    await newTask(s, 'Nice to have', { required: false })
    await runToDone(s, req.id)
    expect(await statusOf(s)).toBe('done')
    const extra = await newTask(s, 'Another')
    expect(await statusOf(s)).toBe('doing')
    await transitionTask(s.ctx, s.project.id, extra.id, {
      action: 'cancel',
      expectedVersion: extra.version,
      reason: 'Out of scope',
    })
    expect(await statusOf(s)).toBe('done')
  })

  it('syncs immediately when switching a cell that already has tasks', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    await runToDone(s, t.id)
    await setCellProgressMode(s.ctx, s.project.id, s.cellId, 'manual')
    await applyChanges(s.ctx, s.project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'Implement', status: 'todo' }],
    })
    await setCellProgressMode(s.ctx, s.project.id, s.cellId, 'tasks')
    expect(await statusOf(s)).toBe('done')
  })
})

describe('task transitions', () => {
  it('rejects an action from the wrong state without changing anything', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    await expect(
      transitionTask(s.ctx, s.project.id, t.id, { action: 'accept', expectedVersion: t.version }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await getTask(s.ctx, s.project.id, t.id)).version).toBe(t.version)
  })

  it('rejects a stale version', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    await transitionTask(s.ctx, s.project.id, t.id, { action: 'mark_ready', expectedVersion: 1 })
    await expect(
      transitionTask(s.ctx, s.project.id, t.id, { action: 'start', expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'conflict', details: { code: 'stale_version' } })
  })

  it('records who did each step', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    const next = await transitionTask(s.ctx, s.project.id, t.id, {
      action: 'mark_ready',
      expectedVersion: t.version,
    })
    expect(next.events.map((e) => [e.action, e.actor.name])).toEqual([
      ['create', 'Pond'],
      ['mark_ready', 'Pond'],
    ])
  })

  it('emits no realtime event and writes no audit when a transition fails', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    const before = (await s.db.db.select().from(auditLog)).length
    const events = await captureEvents(async () => {
      await expect(
        transitionTask(s.ctx, s.project.id, t.id, { action: 'accept', expectedVersion: t.version }),
      ).rejects.toThrow()
    })
    expect(events).toEqual([])
    expect((await s.db.db.select().from(auditLog)).length).toBe(before)
  })

  it('publishes the task update and the cell update when the cell moves', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    const ready = await transitionTask(s.ctx, s.project.id, t.id, {
      action: 'mark_ready',
      expectedVersion: t.version,
    })
    const events = await captureEvents(() =>
      transitionTask(s.ctx, s.project.id, t.id, {
        action: 'start',
        expectedVersion: ready.version,
      }),
    )
    expect(events.map((e) => e.type).sort()).toEqual(['cell.updated', 'task.updated'])
    expect(events.find((e) => e.type === 'cell.updated')).toMatchObject({
      status: 'doing',
      fromStatus: 'todo',
    })
  })
})

describe('permissions', () => {
  it('lets viewers read but not write, and hides other projects', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    const viewer = await createUser(s.db, { name: 'Vi' })
    await addMember(s.db, s.project.id, viewer.userId, 'viewer')
    const vctx = makeCtx(s.db, viewer)
    expect(await listTasks(vctx, s.project.id)).toHaveLength(1)
    await expect(
      transitionTask(vctx, s.project.id, t.id, {
        action: 'mark_ready',
        expectedVersion: t.version,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const outsider = await createUser(s.db, { name: 'Out' })
    await expect(getTask(makeCtx(s.db, outsider), s.project.id, t.id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('does not accept a task from another project by id', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'API')
    const other = await seedProject(s.db, s.admin, { name: 'Other' })
    await expect(getTask(s.ctx, other.id, t.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('only lets project members own tasks', async () => {
    const s = await taskCell()
    const stranger = await createUser(s.db, { name: 'Stranger' })
    await expect(newTask(s, 'API', { ownerUserId: stranger.userId })).rejects.toMatchObject({
      code: 'validation_error',
    })
    const member = await createUser(s.db, { name: 'Mem' })
    await addMember(s.db, s.project.id, member.userId, 'editor')
    const t = await newTask(s, 'API', { ownerUserId: member.userId })
    expect(t.owner).toEqual({ userId: member.userId, name: 'Mem' })
  })
})

describe('editing tasks', () => {
  it('changing required recomputes the cell', async () => {
    const s = await taskCell()
    const a = await newTask(s, 'A')
    const b = await newTask(s, 'B')
    await runToDone(s, a.id)
    expect(await statusOf(s)).toBe('doing')
    await updateTask(s.ctx, s.project.id, b.id, { expectedVersion: b.version, required: false })
    expect(await statusOf(s)).toBe('done')
  })

  it('refuses edits to finished tasks and requires a change', async () => {
    const s = await taskCell()
    const t = await newTask(s, 'A')
    await expect(
      updateTask(s.ctx, s.project.id, t.id, { expectedVersion: t.version }),
    ).rejects.toMatchObject({ code: 'validation_error' })
    await runToDone(s, t.id)
    const done = await getTask(s.ctx, s.project.id, t.id)
    await expect(
      updateTask(s.ctx, s.project.id, t.id, { expectedVersion: done.version, title: 'B' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('lists tasks with their place on the board', async () => {
    const s = await taskCell()
    await newTask(s, 'A')
    const [t] = await listTasks(s.ctx, s.project.id, { cellId: s.cellId })
    expect(t).toMatchObject({ itemPath: 'Login', stageName: 'Implement', state: 'draft' })
    expect(await listTasks(s.ctx, s.project.id, { state: 'done' })).toEqual([])
    expect(
      await s.db.db.select().from(cellEvents).where(eq(cellEvents.cellId, s.cellId)),
    ).toHaveLength(0)
  })
})
