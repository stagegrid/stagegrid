import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

import { authenticateSession } from '../../services/auth.service'
import { authenticateOAuthAccess } from '../../services/oauth.service'
import { authenticateToken } from '../../services/tokens.service'
import type { AppEnv } from '../env'

export const SESSION_COOKIE = 'sg_session'

export function bearerToken(header: string | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  return m?.[1] ?? null
}

/** Resolves the caller from `Authorization: Bearer <token>` (via "api") or the session cookie (via "web"). */
export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get('deps')
  c.set('auth', null)
  const bearer = bearerToken(c.req.header('authorization'))
  if (bearer) {
    const actor =
      (await authenticateToken(deps.database.db, deps.config, bearer, deps.now(), 'api')) ??
      (await authenticateOAuthAccess(deps.database.db, deps.config, bearer, deps.now(), 'api'))
    if (actor) c.set('auth', { actor, sessionId: null, via: 'bearer' })
    return next()
  }
  const token = getCookie(c, SESSION_COOKIE)
  if (token) {
    const session = await authenticateSession(deps.database.db, deps.config, token, deps.now())
    if (session)
      c.set('auth', { actor: session.actor, sessionId: session.sessionId, via: 'cookie' })
  }
  await next()
}
