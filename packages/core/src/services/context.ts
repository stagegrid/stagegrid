import type { Via } from '@stagegrid/shared'

import type { Config } from '../config/config'
import type { DbOrTx, Tx } from '../db/client'
import { unauthenticated } from '../errors'

export interface Actor {
  userId: string
  name: string
  isAdmin: boolean
  via: Via
}

export type ServiceConfig = Pick<Config, 'appUrl' | 'appSecret' | 'sessionTtlDays'>

export interface ServiceContext {
  db: DbOrTx
  actor: Actor | null
  now: () => Date
  config: ServiceConfig
}

export function requireActor(ctx: ServiceContext): Actor {
  if (!ctx.actor) throw unauthenticated()
  return ctx.actor
}

/** Runs `fn` in a transaction (a savepoint when ctx.db is already a transaction). */
export function withTx<T>(
  ctx: ServiceContext,
  fn: (tx: Tx, txCtx: ServiceContext) => Promise<T>,
): Promise<T> {
  return ctx.db.transaction((tx) => fn(tx, { ...ctx, db: tx }))
}
