import type { Context } from 'hono'
import type { z } from 'zod'

import { unauthenticated } from '../errors'
import type { ServiceContext } from '../services/context'
import type { AppEnv, AuthState } from './env'

export function serviceCtx(c: Context<AppEnv>): ServiceContext {
  const deps = c.get('deps')
  return {
    db: deps.database.db,
    actor: c.get('auth')?.actor ?? null,
    now: deps.now,
    config: deps.config,
  }
}

export function requireAuth(c: Context<AppEnv>): AuthState {
  const auth = c.get('auth')
  if (!auth) throw unauthenticated()
  return auth
}

export async function body<S extends z.ZodType>(
  c: Context<AppEnv>,
  schema: S,
): Promise<z.infer<S>> {
  const text = await c.req.text()
  return schema.parse(text ? JSON.parse(text) : {})
}

export function clientIp(c: Context<AppEnv>): string {
  const deps = c.get('deps')
  if (deps.config.trustProxy) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (fwd) return fwd
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming
  return incoming?.socket?.remoteAddress ?? 'unknown'
}
