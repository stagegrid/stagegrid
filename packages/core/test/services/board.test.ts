import { describe, expect, it } from 'vitest'

import { getActivity, getBoard, getSummary } from '../../src/services/board.service'
import { applyChanges } from '../../src/services/changes.service'
import { exportCsv, exportJson } from '../../src/services/export.service'
import { updateProject } from '../../src/services/projects.service'
import { useTestDatabase } from '../helpers/db'
import { createUser, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true, name: 'Pond' })
  const project = await seedProject(db, admin, {
    tree: [{ name: 'Login' }, { name: 'ตั้งค่า', children: [{ name: 'Users, admins' }] }],
  })
  const ctx = makeCtx(db, admin)
  await applyChanges(ctx, project.id, {
    dryRun: false,
    changes: [
      { item: 'Login', stage: 'Design', status: 'done' },
      { item: 'Login', stage: 'Document', status: 'skip' },
      { item: 'Login', stage: 'Database', status: 'doing', happenedAt: '2026-10-01T00:00:00Z' },
    ],
  })
  return { db, admin, project, ctx }
}

describe('board', () => {
  it('computes stats, per-stage stats, and stale flags', async () => {
    const { ctx, project } = await setup()
    const board = await getBoard(ctx, project.id)
    expect(board.stats).toMatchObject({
      items: 3,
      all: 17,
      open: 16,
      doing: 1,
      done: 1,
      percent: 5.9,
      stale: 1,
    })
    const login = board.items.find((i) => i.name === 'Login')!
    const db = board.stages.find((s) => s.name === 'Database')!
    expect(board.cells[login.id]![db.id]).toMatchObject({
      status: 'doing',
      stale: 'doing_too_long',
    })
    const design = board.stages.find((s) => s.name === 'Design')!
    expect(board.stats.byStage[design.id]).toMatchObject({ all: 3, done: 1, percent: 33.3 })
    await updateProject(ctx, project.id, { staleDays: 30 })
    expect((await getBoard(ctx, project.id)).stats.stale).toBe(0)
  })

  it('summarises by stage name', async () => {
    const { ctx, project } = await setup()
    const s = await getSummary(ctx, project.slug)
    expect(s.byStage.map((x) => x.stage)).toEqual([
      'Design',
      'Document',
      'Database',
      'Implement',
      'QA',
      'Deploy',
    ])
    expect(s.stats.items).toBe(3)
  })

  it('lists recent activity newest first', async () => {
    const { ctx, project } = await setup()
    const activity = await getActivity(ctx, project.id)
    expect(activity[0]).toMatchObject({
      action: 'cell.status',
      actor: { name: 'Pond', via: 'web' },
    })
    expect(activity.map((a) => a.action)).toContain('project.create')
  })
})

describe('export', () => {
  it('exports nested JSON with events', async () => {
    const { ctx, project } = await setup()
    const json = await exportJson(ctx, project.id)
    expect(json.version).toBe(1)
    expect(json.items).toEqual([
      { name: 'Login', children: [] },
      { name: 'ตั้งค่า', children: [{ name: 'Users, admins', children: [] }] },
    ])
    const cell = json.cells.find((c) => c.itemPath === 'Login' && c.stage === 'Design')!
    expect(cell.events).toEqual([
      expect.objectContaining({ from: 'todo', to: 'done', actor: 'Pond', via: 'web' }),
    ])
  })

  it('exports CSV with BOM, quoting, and one row per item', async () => {
    const { ctx, project } = await setup()
    const csv = await exportCsv(ctx, project.id)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines[0]).toBe('path,Design,Document,Database,Implement,QA,Deploy')
    expect(lines[1]).toBe('Login,done,skip,doing,todo,todo,todo')
    expect(lines[3]).toBe('"ตั้งค่า > Users, admins",todo,todo,todo,todo,todo,todo')
  })
})
