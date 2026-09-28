import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'

import type { AppEnv } from './env'
import { SESSION_COOKIE } from './middleware/auth'

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  const { config } = c.get('deps')
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: config.secureCookies,
    maxAge: config.sessionTtlDays * 86_400,
  })
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
