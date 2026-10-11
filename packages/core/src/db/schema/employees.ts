import { sql } from 'drizzle-orm'
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'
import { employeeProvider, employeeRole } from './enums'
import { projects } from './projects'

const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * A named AI employee of one project. Identity is the id: renaming, switching role, provider or
 * model never rewrites history, and archiving only stops new work.
 */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    role: employeeRole('role').notNull(),
    instructions: text('instructions').notNull().default(''),
    /** The runtime profile. Runs copy it when they start, so changes only affect future runs. */
    provider: employeeProvider('provider').notNull(),
    model: text('model'),
    /** A short emoji or letters; no uploads in the MVP. */
    avatar: text('avatar'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    index('employees_project_idx').on(t.projectId),
    uniqueIndex('employees_name_uq')
      .on(t.projectId, sql`lower(${t.displayName})`)
      .where(sql`${t.archivedAt} is null`),
  ],
)
