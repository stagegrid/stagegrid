import type { ActorDto, RealtimeEvent } from '@stagegrid/shared'
import { sql } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import type { ServiceContext } from '../services/context'

export const CHANNEL = 'stagegrid_events'
const MAX_PAYLOAD_BYTES = 7500

export function actorDto(ctx: ServiceContext): ActorDto {
  return ctx.actor
    ? { userId: ctx.actor.userId, name: ctx.actor.name, via: ctx.actor.via }
    : { userId: null, name: 'System', via: 'system' }
}

/**
 * Queues a realtime event with pg_notify. Postgres delivers it only when the surrounding
 * transaction commits, so a rollback (including dry runs) never leaks an event.
 */
export async function notify(
  db: DbOrTx,
  ctx: ServiceContext,
  projectId: string,
  type: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const event: RealtimeEvent = {
    ...data,
    type,
    projectId,
    actor: actorDto(ctx),
    at: ctx.now().toISOString(),
  }
  let payload = JSON.stringify(event)
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
    payload = JSON.stringify({
      type: 'board.invalidated',
      projectId,
      actor: event.actor,
      at: event.at,
    })
  }
  await db.execute(sql`select pg_notify(${CHANNEL}, ${payload})`)
}
