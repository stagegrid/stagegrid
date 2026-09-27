import { describe, expect, it } from 'vitest'

import { getCellByRefs, listStaleCells } from '../../src/services/board.service'
import { applyChanges } from '../../src/services/changes.service'
import { listStages, manageStages } from '../../src/services/stages.service'
import { useTestDatabase } from '../helpers/db'
import { createUser, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true })
  const project = await seedProject(db, admin, {
    tree: [{ name: 'Login' }, { name: 'Settings', children: [{ name: 'Users' }] }],
  })
  return { db, project, ctx: makeCtx(db, admin) }
}

describe('getCellByRefs', () => {
  it('finds a cell by item path and stage name', async () => {
    const { ctx, project } = await setup()
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [{ item: 'Settings > Users', stage: 'QA', status: 'doing' }],
    })
    const cell = await getCellByRefs(ctx, project.slug, 'settings > users', 'qa')
    expect(cell).toMatchObject({
      itemPath: 'Settings > Users',
      stageName: 'QA',
      status: 'doing',
      events: [expect.objectContaining({ toStatus: 'doing' })],
    })
    await expect(getCellByRefs(ctx, project.slug, 'Users', 'QA')).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

describe('listStaleCells', () => {
  it('lists stale cells in board order with the reason', async () => {
    const { ctx, project } = await setup()
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [
        {
          item: 'Settings > Users',
          stage: 'Design',
          status: 'doing',
          happenedAt: '2026-10-01T00:00:00Z',
        },
        { item: 'Login', stage: 'QA', status: 'doing', happenedAt: '2026-10-02T00:00:00Z' },
        { item: 'Login', stage: 'Deploy', status: 'doing' },
      ],
    })
    expect(await listStaleCells(ctx, project.id)).toEqual([
      {
        item: 'Login',
        stage: 'QA',
        status: 'doing',
        reason: 'doing_too_long',
        since: '2026-10-02T00:00:00.000Z',
        plannedEnd: null,
      },
      {
        item: 'Settings > Users',
        stage: 'Design',
        status: 'doing',
        reason: 'doing_too_long',
        since: '2026-10-01T00:00:00.000Z',
        plannedEnd: null,
      },
    ])
  })
})

describe('manageStages', () => {
  it('applies several operations atomically by stage name', async () => {
    const { ctx, project } = await setup()
    await manageStages(ctx, project.id, [
      { op: 'add', name: 'SIT', after: 'QA' },
      { op: 'add', name: 'UAT', after: 'SIT' },
      { op: 'rename', stage: 'Document', name: 'Docs' },
      { op: 'archive', stage: 'Database' },
      { op: 'move', stage: 'Deploy', before: 'Design' },
    ])
    const active = (await listStages(ctx, project.id))
      .filter((s) => !s.archivedAt)
      .map((s) => s.name)
    expect(active).toEqual(['Deploy', 'Design', 'Docs', 'Implement', 'QA', 'SIT', 'UAT'])
    await manageStages(ctx, project.id, [{ op: 'restore', stage: 'database' }])
    expect(
      (await listStages(ctx, project.id)).find((s) => s.name === 'Database')?.archivedAt,
    ).toBeNull()
  })

  it('rolls back every operation when one fails', async () => {
    const { ctx, project } = await setup()
    await expect(
      manageStages(ctx, project.id, [
        { op: 'add', name: 'SIT' },
        { op: 'rename', stage: 'Nope', name: 'X' },
      ]),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect((await listStages(ctx, project.id)).map((s) => s.name)).not.toContain('SIT')
  })
})
