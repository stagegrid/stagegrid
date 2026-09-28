import { describe, expect, it } from 'vitest'

import {
  addMember as addMemberSvc,
  listMembers,
  removeMember,
  updateMember,
} from '../../src/services/members.service'
import {
  createProject,
  getProject,
  listProjects,
  setProjectArchived,
  updateProject,
} from '../../src/services/projects.service'
import { setInstanceSettings } from '../../src/services/settings.service'
import { createStage } from '../../src/services/stages.service'
import { listStages } from '../../src/services/stages.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, createUser, FIXED_NOW, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()

describe('createProject', () => {
  it('creates default stages, owner membership, unique slug, and instance timezone', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    await setInstanceSettings(db.db, { timezone: 'Asia/Bangkok' }, FIXED_NOW)
    const ctx = makeCtx(db, admin)
    const a = await createProject(ctx, { name: 'Clinic OS', description: '' })
    const b = await createProject(ctx, { name: 'Clinic  OS!', description: '' })
    expect([a.slug, b.slug]).toEqual(['clinic-os', 'clinic-os-2'])
    expect(a.timezone).toBe('Asia/Bangkok')
    expect((await listStages(ctx, a.id)).map((s) => s.name)).toEqual([
      'Design',
      'Document',
      'Database',
      'Implement',
      'QA',
      'Deploy',
    ])
    expect(await listMembers(ctx, a.slug)).toEqual([
      expect.objectContaining({ userId: admin.userId, role: 'owner' }),
    ])
  })

  it('copies stages from another project and rejects taken explicit slugs', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const ctx = makeCtx(db, admin)
    const src = await createProject(ctx, { name: 'Source', description: '' })
    await createStage(ctx, src.id, { name: 'UAT' })
    const copy = await createProject(ctx, {
      name: 'Copy',
      description: '',
      copyStagesFrom: 'source',
    })
    expect((await listStages(ctx, copy.id)).map((s) => s.name).at(-1)).toBe('UAT')
    await expect(
      createProject(ctx, { name: 'X', description: '', slug: 'source' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('is admin-only', async () => {
    const db = getDb()
    const user = await createUser(db)
    await expect(
      createProject(makeCtx(db, user), { name: 'Nope', description: '' }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('listProjects / getProject', () => {
  it('shows members only their projects and hides others as not_found', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const user = await createUser(db)
    const mine = await seedProject(db, admin, { name: 'Mine' })
    await seedProject(db, admin, { name: 'Other' })
    await addMember(db, mine.id, user.userId, 'viewer')
    const ctx = makeCtx(db, user)
    expect((await listProjects(ctx)).map((p) => [p.name, p.role])).toEqual([['Mine', 'viewer']])
    await expect(getProject(ctx, 'other')).rejects.toMatchObject({ code: 'not_found' })
    expect((await listProjects(makeCtx(db, admin))).map((p) => p.role)).toEqual(['owner', 'owner'])
  })

  it('archives and filters archived projects; archived projects are read-only', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const ctx = makeCtx(db, admin)
    const p = await seedProject(db, admin)
    await setProjectArchived(ctx, p.id, true)
    expect(await listProjects(ctx)).toEqual([])
    expect((await listProjects(ctx, { archived: true })).map((x) => x.id)).toEqual([p.id])
    await expect(updateProject(ctx, p.id, { name: 'New' })).rejects.toMatchObject({
      code: 'conflict',
    })
    await setProjectArchived(ctx, p.id, false)
    expect((await updateProject(ctx, p.id, { name: 'New', staleDays: 3 })).staleDays).toBe(3)
  })
})

describe('members', () => {
  it('keeps at least one owner', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const bob = await createUser(db)
    const p = await seedProject(db, admin)
    const ctx = makeCtx(db, admin)
    await expect(updateMember(ctx, p.id, admin.userId, 'editor')).rejects.toMatchObject({
      code: 'conflict',
    })
    await addMemberSvc(ctx, p.id, { userId: bob.userId, role: 'owner' })
    await updateMember(ctx, p.id, admin.userId, 'editor')
    await expect(removeMember(ctx, p.id, bob.userId)).rejects.toMatchObject({ code: 'conflict' })
    await expect(
      addMemberSvc(ctx, p.id, { userId: bob.userId, role: 'viewer' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })
})
