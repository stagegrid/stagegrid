import { describe, expect, it } from 'vitest'

import { getBoard, getCellByRefs } from '../../src/services/board.service'
import { applyChanges } from '../../src/services/changes.service'
import { getProject } from '../../src/services/projects.service'
import {
  addReleaseItems,
  cancelRelease,
  createRelease,
  getRelease,
  listReleases,
  markReleased,
  removeReleaseItems,
  setReleasePhases,
  updateRelease,
} from '../../src/services/releases.service'
import { createStage } from '../../src/services/stages.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, createUser, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()
const STAGES = ['Design', 'Document', 'Database', 'Implement', 'QA', 'Deploy']

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true })
  const project = await seedProject(db, admin, {
    tree: [
      { name: 'Login' },
      { name: 'Sales report' },
      { name: 'Settings', children: [{ name: 'Holidays' }, { name: 'Users' }] },
    ],
  })
  const ctx = makeCtx(db, admin)
  // Login was fully built in an earlier release
  await applyChanges(ctx, project.id, {
    dryRun: false,
    changes: STAGES.map((stage) => ({
      item: 'Login',
      stage,
      status: 'done' as const,
      happenedAt: '2026-09-01T00:00:00Z',
    })),
  })
  return { db, admin, project, ctx }
}

describe('releases', () => {
  it('creates a release with the project default phases', async () => {
    const { ctx, project } = await setup()
    const r = await createRelease(ctx, project.id, {
      name: 'v1.2',
      targetDate: '2026-11-25',
      description: '',
    })
    expect(r.phases.map((p) => [p.name, p.freeze])).toEqual([
      ['Dev', false],
      ['SIT', true],
      ['UAT', false],
    ])
    expect(r).toMatchObject({ status: 'active', displayStatus: 'planned', stats: { all: 0 } })
    await expect(
      createRelease(ctx, project.id, { name: 'V1.2', targetDate: '2026-12-01', description: '' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('adds new items with every stage and change items with chosen stages, reopening done cells', async () => {
    const { ctx, project } = await setup()
    await createRelease(ctx, project.id, {
      name: 'v1.2',
      targetDate: '2026-11-25',
      description: '',
    })
    const preview = await addReleaseItems(ctx, project.id, 'v1.2', {
      dryRun: true,
      items: [
        { item: 'Sales report', kind: 'new' },
        { item: 'Login', kind: 'change', stages: ['Implement', 'QA'], note: 'Add OTP' },
      ],
    })
    expect(preview).toEqual({
      dryRun: true,
      added: [
        { item: 'Sales report', kind: 'new', cells: 6 },
        { item: 'Login', kind: 'change', cells: 2 },
      ],
      reopened: [
        { item: 'Login', stage: 'Implement' },
        { item: 'Login', stage: 'QA' },
      ],
    })
    expect((await getRelease(ctx, project.id, 'v1.2')).scope).toEqual([])
    expect((await getCellByRefs(ctx, project.id, 'Login', 'QA')).status).toBe('done')

    await addReleaseItems(ctx, project.id, 'v1.2', {
      dryRun: false,
      items: [
        { item: 'Sales report', kind: 'new' },
        { item: 'Login', kind: 'change', stages: ['Implement', 'QA'], note: 'Add OTP' },
      ],
    })
    const qa = await getCellByRefs(ctx, project.id, 'Login', 'QA')
    expect(qa).toMatchObject({ status: 'todo', rework: 1 })
    expect(qa.events[0]).toMatchObject({ toStatus: 'todo', reason: 'Release v1.2' })
    const r = await getRelease(ctx, project.id, 'v1.2')
    expect(r.itemCount).toEqual({ new: 1, change: 1 })
    expect(r.stats).toMatchObject({ all: 8, done: 0 })
    const login = r.scope.find((i) => i.name === 'Login')!
    expect(login).toMatchObject({ kind: 'change', note: 'Add OTP' })
    expect(Object.keys(login.cells)).toHaveLength(2)
    await expect(
      addReleaseItems(ctx, project.id, 'v1.2', {
        dryRun: false,
        items: [{ item: 'Login', kind: 'new' }],
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('includes descendants and shows ancestors as context', async () => {
    const { ctx, project } = await setup()
    await createRelease(ctx, project.id, { name: 'v2', targetDate: '2026-12-01', description: '' })
    await addReleaseItems(ctx, project.id, 'v2', {
      dryRun: false,
      items: [{ item: 'Settings > Holidays', kind: 'new' }],
    })
    let r = await getRelease(ctx, project.id, 'v2')
    expect(r.scope.map((i) => [i.path, i.kind])).toEqual([
      ['Settings', null],
      ['Settings > Holidays', 'new'],
    ])
    await removeReleaseItems(ctx, project.id, 'v2', ['Settings > Holidays'])
    await addReleaseItems(ctx, project.id, 'v2', {
      dryRun: false,
      items: [{ item: 'Settings', kind: 'new', includeDescendants: true }],
    })
    r = await getRelease(ctx, project.id, 'v2')
    expect(r.scope.map((i) => i.kind)).toEqual(['new', 'new', 'new'])
  })

  it('adds cells of a new stage to active releases for "new" items only', async () => {
    const { ctx, project } = await setup()
    await createRelease(ctx, project.id, {
      name: 'v1.2',
      targetDate: '2026-11-25',
      description: '',
    })
    await addReleaseItems(ctx, project.id, 'v1.2', {
      dryRun: false,
      items: [
        { item: 'Sales report', kind: 'new' },
        { item: 'Login', kind: 'change', stages: ['QA'] },
      ],
    })
    await createStage(ctx, project.id, { name: 'UAT' })
    const r = await getRelease(ctx, project.id, 'v1.2')
    const uat = r.stages.find((s) => s.name === 'UAT')!
    expect(r.scope.find((i) => i.name === 'Sales report')!.cells[uat.id]).toBeDefined()
    expect(r.scope.find((i) => i.name === 'Login')!.cells[uat.id]).toBeUndefined()
  })

  it('computes risks from the freeze phase and target', async () => {
    const { ctx, project } = await setup()
    await createRelease(ctx, project.id, {
      name: 'v1.2',
      targetDate: '2026-11-25',
      description: '',
    })
    await setReleasePhases(ctx, project.id, 'v1.2', [
      { name: 'Dev', plannedStart: '2026-10-01', plannedEnd: '2026-10-24' },
      { name: 'SIT', plannedStart: '2026-10-25', plannedEnd: '2026-11-05', freeze: true },
      { name: 'UAT', plannedStart: '2026-11-06', plannedEnd: '2026-11-20' },
    ])
    await addReleaseItems(ctx, project.id, 'v1.2', {
      dryRun: false,
      items: [{ item: 'Login', kind: 'change', stages: ['Implement'] }],
    })
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'Implement', plannedEnd: '2026-10-30' }],
    })
    const r = await getRelease(ctx, project.id, 'v1.2')
    // today is 2026-10-20: within 7 days of SIT (Oct 25) and planned after SIT starts
    expect(r.risks.map((x) => x.code)).toEqual(['planned_after_freeze', 'not_started_near_freeze'])
    expect(r.displayStatus).toBe('at_risk')
    expect((await listReleases(ctx, project.id))[0]).toMatchObject({ name: 'v1.2', riskCount: 2 })
    expect((await getProject(ctx, project.id)).nextRelease).toMatchObject({
      name: 'v1.2',
      percent: 0,
    })
  })

  it('tags board rows with active releases', async () => {
    const { ctx, project } = await setup()
    await createRelease(ctx, project.id, {
      name: 'v1.2',
      targetDate: '2026-11-25',
      description: '',
    })
    await addReleaseItems(ctx, project.id, 'v1.2', {
      dryRun: false,
      items: [{ item: 'Sales report', kind: 'new' }],
    })
    const board = await getBoard(ctx, project.id)
    expect(board.items.find((i) => i.name === 'Sales report')!.releases.map((r) => r.name)).toEqual(
      ['v1.2'],
    )
    expect(board.items.find((i) => i.name === 'Login')!.releases).toEqual([])
  })

  it('releases with force when work is open, snapshots, then freezes scope', async () => {
    const { ctx, project } = await setup()
    await createRelease(ctx, project.id, {
      name: 'v1.2',
      targetDate: '2026-11-25',
      description: '',
    })
    await addReleaseItems(ctx, project.id, 'v1.2', {
      dryRun: false,
      items: [{ item: 'Login', kind: 'change', stages: ['QA'] }],
    })
    await expect(markReleased(ctx, project.id, 'v1.2')).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringContaining("isn't done"),
    })
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'QA', status: 'done' }],
    })
    const r = await markReleased(ctx, project.id, 'v1.2')
    expect(r).toMatchObject({ status: 'released', displayStatus: 'released', scope: [] })
    expect(r.snapshot).toMatchObject({
      targetDate: '2026-11-25',
      items: [{ path: 'Login', kind: 'change', cells: [{ stage: 'QA', status: 'done' }] }],
    })
    await expect(
      addReleaseItems(ctx, project.id, 'v1.2', {
        dryRun: false,
        items: [{ item: 'Sales report', kind: 'new' }],
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
    })
    await updateRelease(ctx, project.id, 'v1.2', { name: 'v1.2 (Phase 2)' })
    await expect(
      updateRelease(ctx, project.id, 'v1.2 (Phase 2)', { targetDate: '2026-12-01' }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('owners release and cancel; editors cannot', async () => {
    const { db, ctx, project } = await setup()
    const editor = await createUser(db)
    await addMember(db, project.id, editor.userId, 'editor')
    const ed = makeCtx(db, editor)
    await createRelease(ed, project.id, { name: 'v3', targetDate: '2027-01-15', description: '' })
    await expect(cancelRelease(ed, project.id, 'v3')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(markReleased(ed, project.id, 'v3', { force: true })).rejects.toMatchObject({
      code: 'forbidden',
    })
    await cancelRelease(ctx, project.id, 'v3')
    expect(
      (await listReleases(ctx, project.id, { status: 'cancelled' })).map((r) => r.name),
    ).toEqual(['v3'])
  })
})
