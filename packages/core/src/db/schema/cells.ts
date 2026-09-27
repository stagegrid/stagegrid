import { date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'
import { actorVia, cellStatus, roundOutcome } from './enums'
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
