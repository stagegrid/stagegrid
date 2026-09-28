import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './auth'
import { cells } from './cells'
import { releaseItemKind, releaseStatus } from './enums'
import { items, projects } from './projects'

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const releases = pgTable(
  'releases',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    targetDate: date('target_date', { mode: 'string' }).notNull(),
    status: releaseStatus('status').notNull().default('active'),
    releasedAt: ts('released_at'),
    releasedBy: uuid('released_by').references(() => users.id),
    snapshot: jsonb('snapshot'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('releases_project_idx').on(t.projectId),
    uniqueIndex('releases_name_uq')
      .on(t.projectId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
  ],
)

export const releasePhases = pgTable(
  'release_phases',
  {
    id: uuid('id').primaryKey(),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedEnd: date('planned_end', { mode: 'string' }),
    freeze: boolean('freeze').notNull().default(false),
    position: text('position').notNull(),
  },
  (t) => [index('release_phases_release_idx').on(t.releaseId)],
)

export const releaseItems = pgTable(
  'release_items',
  {
    id: uuid('id').primaryKey(),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    kind: releaseItemKind('kind').notNull(),
    note: text('note'),
    addedBy: uuid('added_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('release_items_uq').on(t.releaseId, t.itemId)],
)

export const releaseCells = pgTable(
  'release_cells',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    cellId: uuid('cell_id')
      .notNull()
      .references(() => cells.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.cellId] }),
    index('release_cells_cell_idx').on(t.cellId),
  ],
)
