import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { auditLog, cellEvents } from '../../src/db/schema'
import { getBoard, getCellDetail } from '../../src/services/board.service'
import { applyChanges } from '../../src/services/changes.service'
import { createItems } from '../../src/services/items.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, asVia, createUser, FIXED_NOW, makeCtx, seedProject } from '../helpers/factories'
import { captureEvents } from '../helpers/listen'

const getDb = useTestDatabase()
const tree = [{ name: 'Login' }, { name: 'Settings', children: [{ name: 'Users' }] }]
const at = (iso: string) => new Date(iso).toISOString()

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true, name: 'Pond' })
  const project = await seedProject(db, admin, { tree })
  return { db, admin, project, ctx: makeCtx(db, admin) }
}

const cellOf = async (
  ctx: ReturnType<typeof makeCtx>,
  projectId: string,
  itemName: string,
  stageName: string,
) => {
  const b = await getBoard(ctx, projectId)
  const item = b.items.find((i) => i.name === itemName)!
  const stage = b.stages.find((s) => s.name === stageName)!
  return b.cells[item.id]![stage.id]!
}

describe('applyChanges', () => {
  it('changes status, records the event, and reports before/after', async () => {
    const { ctx, project } = await setup()
    const res = await applyChanges(ctx, project.slug, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'design', status: 'doing', reason: 'kickoff' }],
    })
    expect(res).toMatchObject({ dryRun: false, applied: 1, unchanged: 0 })
    expect(res.results[0]).toMatchObject({
      item: 'Login',
      stage: 'Design',
      outcome: 'changed',
      before: { status: 'todo' },
      after: { status: 'doing' },
    })
    const cell = await cellOf(ctx, project.id, 'Login', 'Design')
    expect(cell.status).toBe('doing')
    const detail = await getCellDetail(ctx, project.id, cell.id)
    expect(detail.events).toEqual([
      expect.objectContaining({
        fromStatus: 'todo',
        toStatus: 'doing',
        reason: 'kickoff',
        actor: { userId: expect.any(String), name: 'Pond', via: 'web' },
      }),
    ])
    expect(detail.rounds).toEqual([
      { roundNo: 1, startedAt: FIXED_NOW.toISOString(), endedAt: null, outcome: null },
    ])
  })

  it('treats a no-op as unchanged without writing an event', async () => {
    const { db, ctx, project } = await setup()
    const res = await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'Design', status: 'todo' }],
    })
    expect(res).toMatchObject({ applied: 0, unchanged: 1 })
    expect(await db.db.select().from(cellEvents)).toHaveLength(0)
  })

  it('is all-or-nothing and reports every invalid change', async () => {
    const { db, ctx, project } = await setup()
    await expect(
      applyChanges(ctx, project.id, {
        dryRun: false,
        changes: [
          { item: 'Login', stage: 'Design', status: 'done' },
          { item: 'Nope', stage: 'Design', status: 'done' },
          { item: 'Login', stage: 'Nope', status: 'done' },
          { item: 'Login', stage: 'QA' },
          { item: 'Login', stage: 'QA', status: 'done', happenedAt: '2026-10-21T00:00:00Z' },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      details: {
        errors: [
          expect.objectContaining({ index: 1, code: 'not_found' }),
          expect.objectContaining({ index: 2, code: 'not_found' }),
          expect.objectContaining({ index: 3, code: 'invalid' }),
          expect.objectContaining({
            index: 4,
            code: 'invalid',
            message: 'happenedAt is in the future',
          }),
        ],
      },
    })
    expect(await db.db.select().from(cellEvents)).toHaveLength(0)
  })

  it('dry run returns the exact result but writes and notifies nothing', async () => {
    const { db, ctx, project } = await setup()
    let res: Awaited<ReturnType<typeof applyChanges>> | undefined
    const events = await captureEvents(async () => {
      res = await applyChanges(ctx, project.id, {
        dryRun: true,
        changes: [{ item: 'Login', stage: 'Design', status: 'done' }],
      })
    })
    expect(res).toMatchObject({
      dryRun: true,
      applied: 1,
      results: [{ outcome: 'changed', after: { status: 'done' } }],
    })
    expect(events).toEqual([])
    expect(await db.db.select().from(cellEvents)).toHaveLength(0)
    expect(
      await db.db.select().from(auditLog).where(eq(auditLog.action, 'cell.status')),
    ).toHaveLength(0)
    expect((await cellOf(ctx, project.id, 'Login', 'Design')).status).toBe('todo')
  })

  it('backdates: timeline uses happenedAt and flags inserts before a later event', async () => {
    const { ctx, project } = await setup()
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [
        { item: 'Login', stage: 'Design', status: 'doing', happenedAt: at('2026-10-01T02:00:00Z') },
        { item: 'Login', stage: 'Design', status: 'done', happenedAt: at('2026-10-05T02:00:00Z') },
      ],
    })
    const res = await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [
        {
          item: 'Login',
          stage: 'Design',
          status: 'todo',
          happenedAt: at('2026-10-03T02:00:00Z'),
          reason: 'paused',
        },
      ],
    })
    expect(res.results[0]).toMatchObject({
      outcome: 'changed',
      backdatedBeforeLaterEvent: true,
      after: { status: 'done' },
    })
    const cell = await cellOf(ctx, project.id, 'Login', 'Design')
    const detail = await getCellDetail(ctx, project.id, cell.id)
    expect(
      detail.rounds.map((r) => [r.startedAt.slice(0, 10), r.endedAt?.slice(0, 10), r.outcome]),
    ).toEqual([
      ['2026-10-01', '2026-10-03', 'stopped'],
      ['2026-10-05', '2026-10-05', 'done'],
    ])
    expect(detail.events.map((e) => `${e.fromStatus}>${e.toStatus}`)).toEqual([
      'todo>done',
      'doing>todo',
      'todo>doing',
    ])
  })

  it('counts rework on reopen and publishes cell.updated with actor and path', async () => {
    const { db, admin, project } = await setup()
    const ctx = makeCtx(db, asVia(admin, 'mcp'))
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [
        {
          item: 'Settings > Users',
          stage: 'QA',
          status: 'done',
          happenedAt: at('2026-10-10T00:00:00Z'),
        },
      ],
    })
    const events = await captureEvents(() =>
      applyChanges(ctx, project.id, {
        dryRun: false,
        changes: [{ item: 'Settings > Users', stage: 'QA', status: 'doing', reason: 'bug found' }],
      }),
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'cell.updated',
        projectId: project.id,
        itemPath: 'Settings > Users',
        stageName: 'QA',
        fromStatus: 'done',
        status: 'doing',
        rework: 1,
        actor: { userId: admin.userId, name: admin.name, via: 'mcp' },
      }),
    ])
  })

  it('sends one board.invalidated for large batches', async () => {
    const { ctx, project } = await setup()
    await createItems(ctx, project.id, { items: [{ name: 'Reports' }] })
    const stages = ['Design', 'Document', 'Database', 'Implement', 'QA', 'Deploy']
    // 4 items × 6 stages = 24 changed cells, above the 20-event limit
    const changes = ['Login', 'Settings', 'Settings > Users', 'Reports'].flatMap((item) =>
      stages.map((stage) => ({ item, stage, status: 'done' as const })),
    )
    const events = await captureEvents(() =>
      applyChanges(ctx, project.id, { dryRun: false, changes }),
    )
    expect(events.map((e) => e.type)).toEqual(['board.invalidated'])
  })

  it('requires editor', async () => {
    const { db, project } = await setup()
    const viewer = await createUser(db)
    await addMember(db, project.id, viewer.userId, 'viewer')
    await expect(
      applyChanges(makeCtx(db, viewer), project.id, {
        dryRun: false,
        changes: [{ item: 'Login', stage: 'QA', status: 'done' }],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
