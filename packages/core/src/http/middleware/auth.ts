import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

import { authenticateSession } from '../../services/auth.service'
import type { AppEnv } from '../env'

export const SESSION_COOKIE = 'sg_session'

/** Resolves the caller from the session cookie (bearer tokens are added in phase 2). */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get('deps')
  c.set('auth', null)
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const session = await authenticateSession(deps.database.db, deps.config, token, deps.now())
    if (session)
      c.set('auth', { actor: session.actor, sessionId: session.sessionId, via: 'cookie' })
  }
  await next()
}
