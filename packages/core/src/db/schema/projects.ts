import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './auth'
import { projectRole } from './enums'

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description').notNull().default(''),
  timezone: text('timezone').notNull(),
  staleDays: integer('stale_days').notNull().default(7),
  defaultReleasePhases: jsonb('default_release_phases')
    .$type<{ name: string; freeze?: boolean }[]>()
    .notNull()
    .default([{ name: 'Dev' }, { name: 'SIT', freeze: true }, { name: 'UAT' }]),
  archivedAt: ts('archived_at'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRole('role').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_members_user_idx').on(t.userId),
  ],
)

export const stages = pgTable(
  'stages',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: text('position').notNull(),
    archivedAt: ts('archived_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('stages_project_idx').on(t.projectId),
    uniqueIndex('stages_active_name_uq')
      .on(t.projectId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
  ],
)

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    position: text('position').notNull(),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('items_project_idx').on(t.projectId), index('items_parent_idx').on(t.parentId)],
)
