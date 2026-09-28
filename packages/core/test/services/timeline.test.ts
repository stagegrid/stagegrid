import { describe, expect, it } from 'vitest'

import { applyChanges } from '../../src/services/changes.service'
import { getBurnup, getTimeline } from '../../src/services/timeline.service'
import { useTestDatabase } from '../helpers/db'
import { createUser, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()

describe('timeline', () => {
  it('lists lanes for cells with plans or rounds, flags overdue, and spans the data', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const project = await seedProject(db, admin, { tree: [{ name: 'Login' }, { name: 'Reports' }] })
    const ctx = makeCtx(db, admin)
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [
        { item: 'Login', stage: 'Implement', status: 'doing', happenedAt: '2026-10-01T02:00:00Z' },
        { item: 'Login', stage: 'Implement', status: 'done', happenedAt: '2026-10-05T02:00:00Z' },
        {
          item: 'Login',
          stage: 'Implement',
          status: 'doing',
          happenedAt: '2026-10-12T02:00:00Z',
          plannedStart: '2026-09-28',
          plannedEnd: '2026-10-10',
        },
        { item: 'Reports', stage: 'Design', plannedStart: '2026-10-25', plannedEnd: '2026-11-05' },
      ],
    })
    const t = await getTimeline(ctx, project.id)
    expect(t).toMatchObject({ today: '2026-10-20', from: '2026-09-28', to: '2026-11-05' })
    const login = t.items.find((i) => i.name === 'Login')!
    expect(login.lanes).toHaveLength(1)
    expect(login.lanes[0]).toMatchObject({
      status: 'doing',
      overdue: true,
      plannedEnd: '2026-10-10',
    })
    expect(login.lanes[0]!.rounds.map((r) => [r.roundNo, r.outcome])).toEqual([
      [1, 'done'],
      [2, null],
    ])
    expect(t.items.find((i) => i.name === 'Reports')!.lanes[0]).toMatchObject({
      overdue: false,
      rounds: [],
    })
  })

  it('burn-up counts scope and done per day', async () => {
    const db = getDb()
    const admin = await createUser(db, { isAdmin: true })
    const project = await seedProject(db, admin, { tree: [{ name: 'Login' }] })
    const ctx = makeCtx(db, admin)
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [
        { item: 'Login', stage: 'Design', status: 'done', happenedAt: '2026-10-18T02:00:00Z' },
        { item: 'Login', stage: 'Deploy', status: 'skip', happenedAt: '2026-10-19T02:00:00Z' },
      ],
    })
    const { points } = await getBurnup(ctx, project.id)
    // Cells were created "today" (Oct 20); a cell counts from its first event if that is earlier.
    expect(points).toEqual([
      { date: '2026-10-18', scope: 1, done: 1 },
      { date: '2026-10-19', scope: 1, done: 1 },
      { date: '2026-10-20', scope: 5, done: 1 },
    ])
  })
})
