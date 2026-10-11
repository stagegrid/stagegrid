import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { auditLog, taskContextRevisions } from '../../src/db/schema'
import { getBoard } from '../../src/services/board.service'
import { deleteDocument, saveDocDraft } from '../../src/services/docs.service'
import {
  createEmployee,
  listEmployees,
  setEmployeeArchived,
  updateEmployee,
} from '../../src/services/employees.service'
import {
  createTask,
  getContext,
  getTask,
  pinContext,
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
  const project = await seedProject(db, admin, { tree: [{ name: 'Login' }] })
  const ctx = makeCtx(db, admin)
  const board = await getBoard(ctx, project.id)
  const item = board.items[0]!
  const stage = board.stages.find((s) => s.name === 'Implement')!
  const cellId = board.cells[item.id]![stage.id]!.id
  await setCellProgressMode(ctx, project.id, cellId, 'tasks')
  return { db, admin, ctx, project, cellId }
}
type World = Awaited<ReturnType<typeof setup>>

const mali = (s: World, extra = {}) =>
  createEmployee(s.ctx, s.project.id, {
    displayName: 'Mali',
    role: 'dev',
    provider: 'claude_code',
    model: null,
    instructions: '',
    avatar: null,
    ...extra,
  })

const taskFor = (s: World, employeeId: string | null, title = 'Email login') =>
  createTask(s.ctx, s.project.id, {
    cellId: s.cellId,
    title,
    scope: '',
    acceptanceCriteria: [],
    required: true,
    ownerUserId: null,
    employeeId,
  })

const saveSrs = (s: World, text: string, documentId?: string) =>
  saveDocDraft(s.ctx, s.project.id, {
    template: 'srs',
    item: 'Login',
    stage: 'Document',
    documentId,
    draft: { sections: { '1.1': text } },
  })

describe('employees', () => {
  it('keeps identity and history when renamed, re-roled or moved to another runtime (AC-01)', async () => {
    const s = await setup()
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    const renamed = await updateEmployee(s.ctx, s.project.id, e.id, {
      expectedVersion: e.version,
      displayName: 'Malee',
      provider: 'codex',
      model: 'gpt-5',
    })
    expect(renamed).toMatchObject({ id: e.id, displayName: 'Malee', provider: 'codex', version: 2 })
    const after = await getTask(s.ctx, s.project.id, task.id)
    expect(after.employee).toMatchObject({ id: e.id, displayName: 'Malee' })
    const log = await s.db.db.select().from(auditLog).where(eq(auditLog.targetId, e.id))
    expect(log.map((l) => l.action).sort()).toEqual(['employee.create', 'employee.update'])
  })

  it('only owners manage employees; editors and viewers can read', async () => {
    const s = await setup()
    const editor = await createUser(s.db, { name: 'Ed' })
    await addMember(s.db, s.project.id, editor.userId, 'editor')
    const ectx = makeCtx(s.db, editor)
    await expect(
      createEmployee(ectx, s.project.id, {
        displayName: 'X',
        role: 'dev',
        provider: 'claude_code',
        model: null,
        instructions: '',
        avatar: null,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await mali(s)
    expect(await listEmployees(ectx, s.project.id)).toHaveLength(1)
  })

  it('refuses duplicate names among active employees but allows reuse after archiving', async () => {
    const s = await setup()
    const first = await mali(s)
    await expect(mali(s, { displayName: 'mali' })).rejects.toMatchObject({ code: 'conflict' })
    await setEmployeeArchived(s.ctx, s.project.id, first.id, true)
    await mali(s)
    await expect(setEmployeeArchived(s.ctx, s.project.id, first.id, false)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('rejects stale versions and edits to archived employees', async () => {
    const s = await setup()
    const e = await mali(s)
    await updateEmployee(s.ctx, s.project.id, e.id, { expectedVersion: 1, avatar: '🧑‍💻' })
    await expect(
      updateEmployee(s.ctx, s.project.id, e.id, { expectedVersion: 1, avatar: 'x' }),
    ).rejects.toMatchObject({ code: 'conflict', details: { code: 'stale_version' } })
    await setEmployeeArchived(s.ctx, s.project.id, e.id, true)
    await expect(
      updateEmployee(s.ctx, s.project.id, e.id, { expectedVersion: 3, avatar: 'y' }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await listEmployees(s.ctx, s.project.id)).toHaveLength(0)
    expect(await listEmployees(s.ctx, s.project.id, { includeArchived: true })).toHaveLength(1)
  })

  it('does not let tasks use archived or other projects employees', async () => {
    const s = await setup()
    const e = await mali(s)
    const other = await seedProject(s.db, s.admin, { name: 'Other' })
    const stranger = await createEmployee(s.ctx, other.id, {
      displayName: 'Nok',
      role: 'qa',
      provider: 'codex',
      model: null,
      instructions: '',
      avatar: null,
    })
    await expect(taskFor(s, stranger.id)).rejects.toMatchObject({ code: 'validation_error' })
    await setEmployeeArchived(s.ctx, s.project.id, e.id, true)
    await expect(taskFor(s, e.id)).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('keeps archived employees on the tasks they already have', async () => {
    const s = await setup()
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    await setEmployeeArchived(s.ctx, s.project.id, e.id, true)
    expect((await getTask(s.ctx, s.project.id, task.id)).employee?.id).toBe(e.id)
  })

  it('can reassign only before work starts', async () => {
    const s = await setup()
    const a = await mali(s)
    const b = await mali(s, { displayName: 'Nok' })
    const task = await taskFor(s, a.id)
    const moved = await updateTask(s.ctx, s.project.id, task.id, {
      expectedVersion: task.version,
      employeeId: b.id,
    })
    expect(moved.employee?.id).toBe(b.id)
    const humanTask = await taskFor(s, null, 'Human work')
    const ready = await transitionTask(s.ctx, s.project.id, humanTask.id, {
      action: 'mark_ready',
      expectedVersion: humanTask.version,
    })
    const started = await transitionTask(s.ctx, s.project.id, humanTask.id, {
      action: 'start',
      expectedVersion: ready.version,
    })
    await expect(
      updateTask(s.ctx, s.project.id, humanTask.id, {
        expectedVersion: started.version,
        employeeId: a.id,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('publishes an employee.updated event', async () => {
    const s = await setup()
    const events = await captureEvents(() => mali(s))
    expect(events.map((e) => e.type)).toEqual(['employee.updated'])
  })
})

describe('pinned context', () => {
  const markReady = (s: World, id: string) =>
    transitionTask(s.ctx, s.project.id, id, {
      action: 'mark_ready',
      expectedVersion: 1,
    })

  it('blocks Ready for an employee task until a context is pinned (AC-02)', async () => {
    const s = await setup()
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    await expect(markReady(s, task.id)).rejects.toMatchObject({
      code: 'validation_error',
      details: { code: 'not_ready' },
    })
    await pinContext(s.ctx, s.project.id, task.id, {
      documentIds: [],
      sources: [],
      decisions: [],
    })
    await expect(markReady(s, task.id)).rejects.toMatchObject({
      message: expect.stringContaining('empty'),
    })
    await pinContext(s.ctx, s.project.id, task.id, {
      documentIds: [],
      sources: [],
      decisions: ['Sign-in uses email and password'],
    })
    expect((await markReady(s, task.id)).state).toBe('ready')
  })

  it('does not ask for context on work done by people', async () => {
    const s = await setup()
    const task = await taskFor(s, null)
    expect((await markReady(s, task.id)).state).toBe('ready')
  })

  it('pins documents at their saved revision and keeps the pin when the document changes (AC-09)', async () => {
    const s = await setup()
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    const doc = await saveSrs(s, 'Version one')
    const rev = await pinContext(s.ctx, s.project.id, task.id, {
      documentIds: [doc.documentId],
      sources: [
        {
          title: 'Customer email',
          url: 'https://example.com/mail/1',
          content: 'Must work offline',
        },
      ],
      decisions: ['Email login only'],
    })
    expect(rev.revisionNo).toBe(1)
    expect(rev.manifest.documents[0]).toMatchObject({ documentId: doc.documentId, version: 1 })
    expect(rev.manifest.sources[0]).toMatchObject({ content: 'Must work offline' })
    expect(rev.outdated).toEqual([])

    await saveSrs(s, 'Version two', doc.documentId)
    const again = await getContext(s.ctx, s.project.id, task.id)
    expect(again.manifestHash).toBe(rev.manifestHash)
    expect(again.manifest).toEqual(rev.manifest)
    expect(again.outdated).toEqual([
      expect.objectContaining({ documentId: doc.documentId, pinnedVersion: 1, currentVersion: 2 }),
    ])
    const detail = await getTask(s.ctx, s.project.id, task.id)
    expect(detail.context).toMatchObject({ revisionNo: 1 })
    expect(detail.context?.outdated).toHaveLength(1)
  })

  it('adds a new revision instead of changing the old one', async () => {
    const s = await setup()
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    const first = await pinContext(s.ctx, s.project.id, task.id, {
      documentIds: [],
      sources: [],
      decisions: ['A'],
    })
    const second = await pinContext(s.ctx, s.project.id, task.id, {
      documentIds: [],
      sources: [],
      decisions: ['A', 'B'],
    })
    expect(second.revisionNo).toBe(2)
    expect(
      (await getContext(s.ctx, s.project.id, task.id, first.revisionId)).manifest.decisions,
    ).toEqual(['A'])
    expect((await getContext(s.ctx, s.project.id, task.id)).revisionId).toBe(second.revisionId)
  })

  it('rejects documents from another project', async () => {
    const s = await setup()
    const other = await seedProject(s.db, s.admin, { name: 'Other', tree: [{ name: 'Home' }] })
    const foreign = await saveDocDraft(s.ctx, other.id, {
      template: 'srs',
      item: 'Home',
      stage: 'Document',
      draft: { sections: { '1.1': 'x' } },
    })
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    await expect(
      pinContext(s.ctx, s.project.id, task.id, {
        documentIds: [foreign.documentId],
        sources: [],
        decisions: [],
      }),
    ).rejects.toMatchObject({ code: 'validation_error' })
    expect(await s.db.db.select().from(taskContextRevisions)).toHaveLength(0)
  })

  it('blocks Ready when a pinned document was deleted', async () => {
    const s = await setup()
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    const doc = await saveSrs(s, 'Version one')
    await pinContext(s.ctx, s.project.id, task.id, {
      documentIds: [doc.documentId],
      sources: [],
      decisions: [],
    })
    await deleteDocument(s.ctx, s.project.id, doc.documentId)
    await expect(markReady(s, task.id)).rejects.toMatchObject({
      message: expect.stringContaining('no longer available'),
    })
  })

  it('refuses to rewrite a pinned revision, even with direct SQL', async () => {
    const s = await setup()
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    await pinContext(s.ctx, s.project.id, task.id, {
      documentIds: [],
      sources: [],
      decisions: ['A'],
    })
    await expect(
      s.db.db.execute(sql`update task_context_revisions set manifest_hash = 'x'`),
    ).rejects.toThrow()
  })

  it('needs editor access and hides tasks of other projects', async () => {
    const s = await setup()
    const e = await mali(s)
    const task = await taskFor(s, e.id)
    const viewer = await createUser(s.db, { name: 'Vi' })
    await addMember(s.db, s.project.id, viewer.userId, 'viewer')
    await expect(
      pinContext(makeCtx(s.db, viewer), s.project.id, task.id, {
        documentIds: [],
        sources: [],
        decisions: ['A'],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const other = await seedProject(s.db, s.admin, { name: 'Other' })
    await expect(getContext(s.ctx, other.id, task.id)).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})
