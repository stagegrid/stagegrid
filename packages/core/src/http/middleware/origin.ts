import type { MiddlewareHandler } from 'hono'

import type { AppEnv } from '../env'
import { errorResponse } from '../errors'

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF guard: state-changing requests authenticated by cookie must come from APP_URL's origin.
 * Requests without a session cookie (login, setup, bearer-token calls) are checked the same way
 * when they carry an Origin header.
 */
export const originCheck: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE.has(c.req.method)) return next()
  const expected = c.get('deps').config.appOrigin
  const origin = c.req.header('origin') ?? originOf(c.req.header('referer'))
  const usesCookie =
    c.get('auth')?.via === 'cookie' || c.req.header('cookie')?.includes('sg_session=')
  if (origin && origin !== expected)
    return errorResponse(c, 'forbidden', 'Cross-site request blocked')
  if (!origin && usesCookie) return errorResponse(c, 'forbidden', 'Cross-site request blocked')
  return next()
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}
