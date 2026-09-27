import { describe, expect, it } from 'vitest'

import { APP_ORIGIN, browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()

describe('setup and auth over HTTP', () => {
  it('runs setup once, sets an HttpOnly cookie, and serves /me', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    expect(await (await b.get('/api/v1/setup/status')).json()).toEqual({ needsSetup: true })
    const res = await b.post('/api/v1/setup', SETUP_BODY)
    expect(res.status).toBe(201)
    expect(res.headers.get('set-cookie')).toMatch(
      /sg_session=.+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax/,
    )
    expect(await (await b.get('/api/v1/me')).json()).toMatchObject({
      email: 'pond@example.com',
      isAdmin: true,
    })
    expect((await b.post('/api/v1/setup', SETUP_BODY)).status).toBe(409)
  })

  it('logs in and out', async () => {
    const { app } = makeApp(getDb())
    await browser(app).post('/api/v1/setup', SETUP_BODY)
    const b = browser(app)
    expect((await b.get('/api/v1/me')).status).toBe(401)
    const bad = await b.post('/api/v1/auth/login', {
      email: 'pond@example.com',
      password: 'nope nope nope',
    })
    expect(bad.status).toBe(401)
    expect(await bad.json()).toMatchObject({
      error: { code: 'unauthenticated', message: 'Email or password is incorrect' },
    })
    expect(
      (
        await b.post('/api/v1/auth/login', {
          email: 'POND@example.com',
          password: SETUP_BODY.password,
        })
      ).status,
    ).toBe(200)
    expect((await b.get('/api/v1/me')).status).toBe(200)
    expect((await b.post('/api/v1/auth/logout')).status).toBe(204)
    expect((await b.get('/api/v1/me')).status).toBe(401)
  })

  it('invites a user who accepts via the link', async () => {
    const { app } = makeApp(getDb())
    const admin = browser(app)
    await admin.post('/api/v1/setup', SETUP_BODY)
    const inv = await admin.post('/api/v1/admin/users', { name: 'Bee', email: 'bee@example.com' })
    expect(inv.status).toBe(201)
    const { link } = (await inv.json()) as { link: string }
    const token = new URL(link).searchParams.get('token')!
    const bee = browser(app)
    expect(await (await bee.get(`/api/v1/auth/token-info?token=${token}`)).json()).toEqual({
      kind: 'invite',
      email: 'bee@example.com',
      name: 'Bee',
    })
    expect(
      (await bee.post('/api/v1/auth/accept', { token, password: 'bee password 1' })).status,
    ).toBe(200)
    expect(await (await bee.get('/api/v1/me')).json()).toMatchObject({
      email: 'bee@example.com',
      status: 'active',
      isAdmin: false,
    })
    expect((await bee.get('/api/v1/admin/users')).status).toBe(403)
  })

  it('rate limits login attempts per IP+email', async () => {
    const { app } = makeApp(getDb())
    await browser(app).post('/api/v1/setup', SETUP_BODY)
    const b = browser(app)
    for (let i = 0; i < 10; i++)
      await b.post('/api/v1/auth/login', { email: 'pond@example.com', password: 'wrong wrong' })
    const res = await b.post('/api/v1/auth/login', {
      email: 'pond@example.com',
      password: SETUP_BODY.password,
    })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})

describe('guards and errors', () => {
  it('blocks cross-site cookie requests', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    const evil = await b.post('/api/v1/projects', { name: 'X' }, { origin: 'https://evil.example' })
    expect(evil.status).toBe(403)
    const noOrigin = await app.request('/api/v1/projects', {
      method: 'POST',
      headers: { cookie: b.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    })
    expect(noOrigin.status).toBe(403)
    expect((await b.post('/api/v1/projects', { name: 'X' }, { origin: APP_ORIGIN })).status).toBe(
      201,
    )
  })

  it('formats validation, unknown routes, and adds security headers', async () => {
    const { app } = makeApp(getDb())
    const res = await browser(app).post('/api/v1/setup', { ...SETUP_BODY, email: 'nope' })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({
      error: {
        code: 'validation_error',
        details: { issues: [expect.objectContaining({ path: 'email' })] },
      },
    })
    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const missing = await app.request('/api/v1/nope')
    expect(missing.status).toBe(404)
  })

  it('rejects bodies over 1 MB', async () => {
    const { app } = makeApp(getDb())
    const res = await browser(app).post('/api/v1/setup', {
      ...SETUP_BODY,
      name: 'x'.repeat(1024 * 1024 + 10),
    })
    expect(res.status).toBe(413)
  })

  it('reports health', async () => {
    const { app } = makeApp(getDb())
    expect(await (await app.request('/healthz')).json()).toEqual({ ok: true })
  })
})
