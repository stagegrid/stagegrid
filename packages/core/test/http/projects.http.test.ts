import type { BoardDto, ChangesResultDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()

async function signedInAdmin() {
  const { app, deps } = makeApp(getDb())
  const b = browser(app)
  await b.post('/api/v1/setup', SETUP_BODY)
  return { app, deps, b }
}

describe('projects API', () => {
  it('creates a project, items, and changes cells end to end', async () => {
    const { b } = await signedInAdmin()
    const created = await b.post('/api/v1/projects', { name: 'Clinic OS' })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({
      slug: 'clinic-os',
      timezone: 'Asia/Bangkok',
      role: 'owner',
    })
    const items = await b.post('/api/v1/projects/clinic-os/items', {
      items: [{ name: 'Login' }, { name: 'Settings', children: [{ name: 'Users' }] }],
    })
    expect(await items.json()).toMatchObject({
      items: [{ path: 'Login' }, { path: 'Settings' }, { path: 'Settings > Users' }],
    })
    const res = await b.post('/api/v1/projects/clinic-os/changes', {
      changes: [{ item: 'Settings > Users', stage: 'QA', status: 'done' }],
    })
    const bodyRes = (await res.json()) as ChangesResultDto
    expect(bodyRes).toMatchObject({ applied: 1, results: [{ outcome: 'changed' }] })
    const board = (await (await b.get('/api/v1/projects/clinic-os/board')).json()) as BoardDto
    expect(board.stats).toMatchObject({ items: 3, done: 1 })
    const cell = await b.get(`/api/v1/projects/clinic-os/cells/${bodyRes.results[0]!.cellId}`)
    expect(await cell.json()).toMatchObject({
      itemPath: 'Settings > Users',
      stageName: 'QA',
      status: 'done',
    })
  })

  it('returns ambiguous_ref as 409 and unknown projects as 404', async () => {
    const { b } = await signedInAdmin()
    await b.post('/api/v1/projects', { name: 'Pilot' })
    await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Dup' }, { name: 'dup' }] })
    const res = await b.patch('/api/v1/projects/pilot/items/Dup', { name: 'X' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'ambiguous_ref' } })
    expect((await b.get('/api/v1/projects/nope/board')).status).toBe(404)
  })

  it('exports CSV and JSON as attachments', async () => {
    const { b } = await signedInAdmin()
    await b.post('/api/v1/projects', { name: 'Pilot' })
    const csv = await b.get('/api/v1/projects/pilot/export?format=csv')
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(csv.headers.get('content-disposition')).toMatch(
      /attachment; filename="pilot-\d{4}-\d{2}-\d{2}\.csv"/,
    )
    const json = await b.get('/api/v1/projects/pilot/export')
    expect(await json.json()).toMatchObject({ version: 1, project: { slug: 'pilot' } })
  })

  it('manages stages and members', async () => {
    const { b } = await signedInAdmin()
    await b.post('/api/v1/projects', { name: 'Pilot' })
    const stage = (await (
      await b.post('/api/v1/projects/pilot/stages', { name: 'UAT' })
    ).json()) as { id: string }
    expect((await b.post(`/api/v1/projects/pilot/stages/${stage.id}/archive`)).status).toBe(200)
    const stages = (await (await b.get('/api/v1/projects/pilot/stages')).json()) as {
      name: string
      archivedAt: string | null
    }[]
    expect(stages.find((s) => s.name === 'UAT')?.archivedAt).not.toBeNull()
    const inv = (await (
      await b.post('/api/v1/admin/users', { name: 'Bee', email: 'bee@example.com' })
    ).json()) as { user: { id: string } }
    expect(
      (await b.post('/api/v1/projects/pilot/members', { userId: inv.user.id, role: 'editor' }))
        .status,
    ).toBe(204)
    expect(
      ((await (await b.get('/api/v1/projects/pilot/members')).json()) as unknown[]).length,
    ).toBe(2)
  })
})

describe('timeline API', () => {
  it('serves timeline and burn-up', async () => {
    const { b } = await signedInAdmin()
    await b.post('/api/v1/projects', { name: 'Pilot' })
    await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Login' }] })
    await b.post('/api/v1/projects/pilot/changes', {
      changes: [{ item: 'Login', stage: 'QA', status: 'doing' }],
    })
    const t = (await (await b.get('/api/v1/projects/pilot/timeline')).json()) as {
      items: { lanes: unknown[] }[]
    }
    expect(t.items[0]!.lanes).toHaveLength(1)
    const burnup = (await (await b.get('/api/v1/projects/pilot/burnup')).json()) as {
      points: { scope: number }[]
    }
    expect(burnup.points.at(-1)).toMatchObject({ scope: 6 })
  })
})
