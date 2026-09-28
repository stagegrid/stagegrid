import type { ReleaseDetailDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'
import { call, mcpClient } from '../helpers/mcp'

const getDb = useTestDatabase()

async function world() {
  const { app } = makeApp(getDb())
  const b = browser(app)
  await b.post('/api/v1/setup', SETUP_BODY)
  await b.post('/api/v1/projects', { name: 'Pilot' })
  await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Login' }, { name: 'Reports' }] })
  return { app, b }
}

describe('releases API', () => {
  it('creates a release, adds scope, edits phases, and releases it', async () => {
    const { b } = await world()
    const base = '/api/v1/projects/pilot/releases'
    const created = await b.post(base, { name: 'v1', targetDate: '2026-11-25' })
    expect(created.status).toBe(201)
    const r = (await created.json()) as ReleaseDetailDto
    await b.post(`${base}/${r.id}/items`, {
      items: [{ item: 'Reports', kind: 'new', note: 'Monthly sales' }],
    })
    const phases = await b.put(`${base}/${r.id}/phases`, {
      phases: [{ name: 'SIT', plannedStart: '2026-11-01', plannedEnd: '2026-11-10', freeze: true }],
    })
    expect(phases.status).toBe(200)
    let detail = (await (await b.get(`${base}/v1`)).json()) as ReleaseDetailDto
    expect(detail).toMatchObject({
      itemCount: { new: 1, change: 0 },
      phases: [{ name: 'SIT', freeze: true }],
    })
    expect(detail.scope.find((i) => i.name === 'Reports')).toMatchObject({
      kind: 'new',
      note: 'Monthly sales',
    })
    expect((await b.post(`${base}/${r.id}/release`, {})).status).toBe(409)
    detail = (await (
      await b.post(`${base}/${r.id}/release`, { force: true })
    ).json()) as ReleaseDetailDto
    expect(detail.status).toBe('released')
    const list = (await (await b.get(`${base}?status=released`)).json()) as { name: string }[]
    expect(list.map((x) => x.name)).toEqual(['v1'])
    const exported = (await (await b.get('/api/v1/projects/pilot/export')).json()) as {
      releases: { name: string; snapshot: unknown }[]
    }
    expect(exported.releases[0]).toMatchObject({
      name: 'v1',
      snapshot: expect.objectContaining({ targetDate: '2026-11-25' }),
    })
  })

  it('exposes release tools over MCP', async () => {
    const { app, b } = await world()
    const { token } = (await (await b.post('/api/v1/me/tokens', { name: 'ai' })).json()) as {
      token: string
    }
    const client = await mcpClient(app, token)
    await call(client, 'create_release', {
      project: 'pilot',
      name: 'v2',
      targetDate: '2026-12-15',
      items: [{ item: 'Login', kind: 'new' }],
    })
    const r = await call<{ scope: string[]; stages: string[] }>(client, 'get_release', {
      project: 'pilot',
      release: 'v2',
    })
    expect(r.scope).toEqual(['Login [new] | T T T T T T'])
    await call(client, 'add_release_items', {
      project: 'pilot',
      release: 'v2',
      items: [{ item: 'Reports', kind: 'change', stages: ['QA'] }],
    })
    const list = await call<{ name: string; items: { new: number; change: number } }[]>(
      client,
      'list_releases',
      { project: 'pilot' },
    )
    expect(list).toEqual([expect.objectContaining({ name: 'v2', items: { new: 1, change: 1 } })])
    const tools = (await client.listTools()).tools.map((t) => t.name)
    expect(tools).toEqual(
      expect.arrayContaining([
        'list_releases',
        'get_release',
        'create_release',
        'update_release',
        'add_release_items',
        'remove_release_items',
        'mark_release_released',
      ]),
    )
  })
})
