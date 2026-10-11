import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './auth'
import { questionBatchState, questionState } from './enums'
import { runs } from './runs'
import { taskContextRevisions, tasks } from './tasks'

const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Questions an employee asks together, because it is blocked. A task has at most one open batch;
 * the run continues once, after every blocking question in it is answered.
 */
export const questionBatches = pgTable(
  'question_batches',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    /** The context the employee was working from when it asked. */
    contextRevisionId: uuid('context_revision_id')
      .notNull()
      .references(() => taskContextRevisions.id),
    state: questionBatchState('state').notNull().default('open'),
    askKey: text('ask_key').notNull(),
    /** An answer that changes scope holds the continuation until a new context is pinned. */
    holdForContext: boolean('hold_for_context').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
  },
  (t) => [
    index('question_batches_task_idx').on(t.taskId),
    uniqueIndex('question_batches_ask_key_uq').on(t.runId, t.askKey),
    // One open batch per task, enforced by the database.
    uniqueIndex('question_batches_one_open_uq')
      .on(t.taskId)
      .where(sql`${t.state} = 'open'`),
  ],
)

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => questionBatches.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<string[]>().notNull().default([]),
    state: questionState('state').notNull().default('open'),
    answer: text('answer'),
    /** The person said this answer changes what was agreed, so it needs a new context. */
    changesScope: boolean('changes_scope').notNull().default(false),
    answeredBy: uuid('answered_by').references(() => users.id),
    answeredAt: ts('answered_at'),
    answerKey: text('answer_key'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('questions_batch_idx').on(t.batchId, t.position)],
)
