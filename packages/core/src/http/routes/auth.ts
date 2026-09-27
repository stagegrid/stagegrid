import { acceptInput, loginInput, setupInput } from '@stagegrid/shared'
import { type Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'

import { AppError } from '../../errors'
import * as auth from '../../services/auth.service'
import { needsSetup } from '../../services/settings.service'
import { body, clientIp, serviceCtx } from '../context'
import { clearSessionCookie, setSessionCookie } from '../cookies'
import type { AppEnv } from '../env'
import { SESSION_COOKIE } from '../middleware/auth'

function limit(c: Context<AppEnv>, key: string, which: 'login' | 'public') {
  const deps = c.get('deps')
  const limiter = which === 'login' ? deps.loginLimiter : deps.publicLimiter
  const wait = limiter.hit(key)
  if (wait > 0) {
    c.header('Retry-After', String(wait))
    throw new AppError('rate_limited', 'Too many attempts. Try again later.')
  }
}

export const authRoutes = new Hono<AppEnv>()
  .get('/setup/status', async (c) =>
    c.json({ needsSetup: await needsSetup(c.get('deps').database.db) }),
  )
  .post('/setup', async (c) => {
    limit(c, `setup:${clientIp(c)}`, 'public')
    const input = await body(c, setupInput)
    const res = await auth.setup(serviceCtx(c), input, {
      userAgent: c.req.header('user-agent'),
      ip: clientIp(c),
    })
    setSessionCookie(c, res.sessionToken)
    return c.json({ user: res.user }, 201)
  })
  .post('/auth/login', async (c) => {
    const input = await body(c, loginInput)
    limit(c, `login:${clientIp(c)}:${input.email}`, 'login')
    limit(c, `login-ip:${clientIp(c)}`, 'public')
    const res = await auth.login(serviceCtx(c), input, {
      userAgent: c.req.header('user-agent'),
      ip: clientIp(c),
    })
    setSessionCookie(c, res.sessionToken)
    return c.json({ user: res.user })
  })
  .post('/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) await auth.logout(serviceCtx(c), token)
    clearSessionCookie(c)
    return c.body(null, 204)
  })
  .get('/auth/token-info', async (c) => {
    const token = z.string().min(1).parse(c.req.query('token'))
    return c.json(await auth.tokenInfo(serviceCtx(c), token))
  })
  .post('/auth/accept', async (c) => {
    limit(c, `accept:${clientIp(c)}`, 'public')
    const input = await body(c, acceptInput)
    const res = await auth.acceptToken(serviceCtx(c), input, {
      userAgent: c.req.header('user-agent'),
      ip: clientIp(c),
    })
    setSessionCookie(c, res.sessionToken)
    return c.json({ user: res.user })
  })
