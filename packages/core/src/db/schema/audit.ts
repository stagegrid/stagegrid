import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { actorVia } from './enums'

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id'),
    actorUserId: uuid('actor_user_id'),
    via: actorVia('via').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_project_idx').on(t.projectId, t.createdAt)],
)
