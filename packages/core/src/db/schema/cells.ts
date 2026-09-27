import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './auth'
import { actorVia, cellStatus, linkKind, roundOutcome } from './enums'
import { items, stages } from './projects'

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const cells = pgTable(
  'cells',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'cascade' }),
    status: cellStatus('status').notNull().default('todo'),
    statusChangedAt: ts('status_changed_at'),
    reworkCount: integer('rework_count').notNull().default(0),
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedEnd: date('planned_end', { mode: 'string' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('cells_item_stage_uq').on(t.itemId, t.stageId),
    index('cells_stage_idx').on(t.stageId),
  ],
)

export const cellEvents = pgTable(
  'cell_events',
  {
    id: uuid('id').primaryKey(),
    cellId: uuid('cell_id')
      .notNull()
      .references(() => cells.id, { onDelete: 'cascade' }),
    toStatus: cellStatus('to_status').notNull(),
    happenedAt: ts('happened_at').notNull(),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    via: actorVia('via').notNull(),
    reason: text('reason'),
    deletedAt: ts('deleted_at'),
    deletedBy: uuid('deleted_by').references(() => users.id),
  },
  (t) => [index('cell_events_cell_idx').on(t.cellId, t.happenedAt)],
)

export const cellRounds = pgTable(
  'cell_rounds',
  {
    id: uuid('id').primaryKey(),
    cellId: uuid('cell_id')
      .notNull()
      .references(() => cells.id, { onDelete: 'cascade' }),
    roundNo: integer('round_no').notNull(),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
    outcome: roundOutcome('outcome'),
  },
  (t) => [unique('cell_rounds_cell_no_uq').on(t.cellId, t.roundNo)],
)

export const cellAssignees = pgTable(
  'cell_assignees',
  {
    id: uuid('id').primaryKey(),
    cellId: uuid('cell_id')
      .notNull()
      .references(() => cells.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('cell_assignees_cell_idx').on(t.cellId),
    uniqueIndex('cell_assignees_user_uq')
      .on(t.cellId, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex('cell_assignees_name_uq')
      .on(t.cellId, sql`lower(${t.displayName})`)
      .where(sql`${t.displayName} is not null`),
    check('cell_assignees_one_of', sql`(${t.userId} is null) <> (${t.displayName} is null)`),
  ],
)

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey(),
    cellId: uuid('cell_id')
      .notNull()
      .references(() => cells.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id),
    via: actorVia('via').notNull(),
    body: text('body').notNull(),
    editedAt: ts('edited_at'),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('comments_cell_idx').on(t.cellId, t.createdAt)],
)

export const cellLinks = pgTable(
  'cell_links',
  {
    id: uuid('id').primaryKey(),
    cellId: uuid('cell_id')
      .notNull()
      .references(() => cells.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    url: text('url').notNull(),
    kind: linkKind('kind').notNull().default('other'),
    /** Set when the link points at a Stagegrid document (phase 7). */
    documentId: uuid('document_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('cell_links_cell_idx').on(t.cellId)],
)
