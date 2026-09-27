import { randomUUID } from 'node:crypto'

import type { MiddlewareHandler } from 'hono'

import type { AppDeps, AppEnv } from '../env'

export const withDeps =
  (deps: AppDeps): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    c.set('deps', deps)
    await next()
  }

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id')
  const id = incoming && /^[\w-]{1,100}$/.test(incoming) ? incoming : randomUUID()
  c.set('requestId', id)
  await next()
  c.header('X-Request-Id', id)
}

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'same-origin')
  c.header('X-Frame-Options', 'DENY')
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'",
  )
}

export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = performance.now()
  await next()
  c.get('deps').logger.info(
    {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    },
    'request',
  )
}
