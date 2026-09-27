import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { cells } from '../../src/db/schema'
import { getBoard } from '../../src/services/board.service'
import { createItems, deleteItem, moveItem, renameItem } from '../../src/services/items.service'
import {
  createStage,
  listStages,
  moveStage,
  renameStage,
  setStageArchived,
} from '../../src/services/stages.service'
import { useTestDatabase } from '../helpers/db'
import { createUser, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()

const tree = [
  { name: 'Login' },
  {
    name: 'Settings',
    children: [{ name: 'Users' }, { name: 'Master data', children: [{ name: 'Vehicles' }] }],
  },
  { name: 'Reports' },
]

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true })
  const project = await seedProject(db, admin, { tree })
  return { db, admin, project, ctx: makeCtx(db, admin) }
}

const rows = async (ctx: ReturnType<typeof makeCtx>, id: string) =>
  (await getBoard(ctx, id)).items.map((i) => `${'  '.repeat(i.depth)}${i.name}`)

describe('items', () => {
  it('creates trees in order with a cell per stage', async () => {
    const { ctx, project } = await setup()
    expect(await rows(ctx, project.id)).toEqual([
      'Login',
      'Settings',
      '  Users',
      '  Master data',
      '    Vehicles',
      'Reports',
    ])
    const board = await getBoard(ctx, project.id)
    expect(Object.keys(board.cells)).toHaveLength(6)
    expect(Object.values(board.cells).every((byStage) => Object.keys(byStage).length === 6)).toBe(
      true,
    )
    expect(board.stats).toMatchObject({ items: 6, all: 36, open: 36, done: 0, percent: 0 })
  })

  it('inserts under a parent path and before/after siblings', async () => {
    const { ctx, project } = await setup()
    const res = await createItems(ctx, project.id, {
      parent: 'settings > master data',
      items: [{ name: 'Holidays' }],
    })
    expect(res.items[0]!.path).toBe('Settings > Master data > Holidays')
    await createItems(ctx, project.id, { after: 'Login', items: [{ name: 'Dashboard' }] })
    await createItems(ctx, project.id, { before: 'Login', items: [{ name: 'Home' }] })
    expect((await rows(ctx, project.id)).filter((r) => !r.startsWith(' '))).toEqual([
      'Home',
      'Login',
      'Dashboard',
      'Settings',
      'Reports',
    ])
  })

  it('renames, moves (no cycles), and deletes whole branches', async () => {
    const { ctx, project } = await setup()
    await renameItem(ctx, project.id, 'Reports', 'Sales report')
    const moved = await moveItem(ctx, project.id, 'Settings > Users', {
      parent: null,
      after: 'Login',
    })
    expect(moved.path).toBe('Users')
    await expect(
      moveItem(ctx, project.id, 'Settings', { parent: 'Settings > Master data' }),
    ).rejects.toMatchObject({ code: 'validation_error' })
    expect(await deleteItem(ctx, project.id, 'Settings')).toEqual({ deletedCount: 3 })
    expect(await rows(ctx, project.id)).toEqual(['Login', 'Users', 'Sales report'])
  })

  it('rejects ambiguous and unknown refs with helpful details', async () => {
    const { ctx, project } = await setup()
    await expect(renameItem(ctx, project.id, 'Users', 'X')).rejects.toMatchObject({
      code: 'not_found',
      details: { suggestions: ['Settings > Users'] },
    })
    await createItems(ctx, project.id, { parent: 'Settings', items: [{ name: 'users' }] })
    await expect(renameItem(ctx, project.id, 'Settings > Users', 'X')).rejects.toMatchObject({
      code: 'ambiguous_ref',
    })
  })
})

describe('stages', () => {
  it('adds stages with cells for every item, renames, moves, archives, and restores', async () => {
    const { db, ctx, project } = await setup()
    const uat = await createStage(ctx, project.id, { name: 'UAT' })
    const cellCount = await db.db.select().from(cells).where(eq(cells.stageId, uat.id))
    expect(cellCount).toHaveLength(6)
    await expect(createStage(ctx, project.id, { name: 'uat' })).rejects.toMatchObject({
      code: 'conflict',
    })
    const design = (await listStages(ctx, project.id))[0]!
    await moveStage(ctx, project.id, uat.id, { beforeId: design.id })
    await renameStage(ctx, project.id, uat.id, 'SIT')
    expect((await listStages(ctx, project.id)).map((s) => s.name)[0]).toBe('SIT')
    await setStageArchived(ctx, project.id, uat.id, true)
    expect((await getBoard(ctx, project.id)).stages.map((s) => s.name)).not.toContain('SIT')
    await createItems(ctx, project.id, { items: [{ name: 'New while archived' }] })
    await setStageArchived(ctx, project.id, uat.id, false)
    const board = await getBoard(ctx, project.id)
    const newItem = board.items.find((i) => i.name === 'New while archived')!
    const restored = await db.db
      .select()
      .from(cells)
      .where(and(eq(cells.stageId, uat.id), eq(cells.itemId, newItem.id)))
    expect(restored).toHaveLength(1)
  })

  it('is owner-only', async () => {
    const { db, project } = await setup()
    const editor = await createUser(db)
    const { addMember } = await import('../helpers/factories')
    await addMember(db, project.id, editor.userId, 'editor')
    await expect(
      createStage(makeCtx(db, editor), project.id, { name: 'UAT' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
