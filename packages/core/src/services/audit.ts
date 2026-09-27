import type { DbOrTx } from '../db/client'
import { auditLog } from '../db/schema'
import { newId } from '../lib/ids'
import type { ServiceContext } from './context'

export interface AuditEntry {
  projectId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  before?: unknown
  after?: unknown
}

export async function audit(db: DbOrTx, ctx: ServiceContext, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    id: newId(),
    projectId: entry.projectId ?? null,
    actorUserId: ctx.actor?.userId ?? null,
    via: ctx.actor?.via ?? 'system',
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    createdAt: ctx.now(),
  })
}
