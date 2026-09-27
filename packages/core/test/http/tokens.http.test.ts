import { describe, expect, it } from 'vitest'

import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()

describe('personal access tokens over HTTP', () => {
  it('creates a token that authenticates REST calls as the user via "api"', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    await b.post('/api/v1/projects', { name: 'Pilot' })
    const res = await b.post('/api/v1/me/tokens', { name: 'script' })
    expect(res.status).toBe(201)
    const { token, meta } = (await res.json()) as { token: string; meta: { id: string } }

    const bearer = { authorization: `Bearer ${token}` }
    expect((await app.request('/api/v1/me', { headers: bearer })).status).toBe(200)
    // Bearer requests need no Origin header (no cookie → no CSRF risk)
    const change = await app.request('/api/v1/projects/pilot/items', {
      method: 'POST',
      headers: { ...bearer, 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ name: 'Login' }] }),
    })
    expect(change.status).toBe(201)
    const activity = (await (await b.get('/api/v1/projects/pilot/activity')).json()) as {
      action: string
      actor: { via: string }
    }[]
    expect(activity.find((a) => a.action === 'item.create')?.actor.via).toBe('api')

    expect((await b.delete(`/api/v1/me/tokens/${meta.id}`)).status).toBe(204)
    expect((await app.request('/api/v1/me', { headers: bearer })).status).toBe(401)
  })

  it('does not fall back to the cookie when a bad bearer token is sent', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    expect((await b.get('/api/v1/me', { authorization: 'Bearer sg_pat_wrong' })).status).toBe(401)
  })
})
