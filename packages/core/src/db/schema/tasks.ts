import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './auth'
import { cells } from './cells'
import { employees } from './employees'
import { actorVia, taskState } from './enums'
import { projects } from './projects'

const ts = (name: string) => timestamp(name, { withTimezone: true })

/** A unit of work that contributes to exactly one cell (item x stage). */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    cellId: uuid('cell_id')
      .notNull()
      .references(() => cells.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    scope: text('scope').notNull().default(''),
    acceptanceCriteria: jsonb('acceptance_criteria').$type<string[]>().notNull().default([]),
    /** Optional tasks never hold a cell back. */
    required: boolean('required').notNull().default(true),
    state: taskState('state').notNull().default('draft'),
    /** Bumped on every change; mutations carry the version they saw. */
    version: integer('version').notNull().default(1),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    /** The AI employee the work is assigned to, if any. A person can own it as well. */
    employeeId: uuid('employee_id').references(() => employees.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('tasks_cell_idx').on(t.cellId),
    index('tasks_project_idx').on(t.projectId, t.state),
  ],
)

/** Every state change, with who did it and why (reopening and cancelling need a reason). */
export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    fromState: taskState('from_state'),
    toState: taskState('to_state').notNull(),
    action: text('action').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    via: actorVia('via').notNull(),
    reason: text('reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('task_events_task_idx').on(t.taskId, t.createdAt)],
)

export interface ContextManifest {
  schemaVersion: 1
  /** Stagegrid documents, pinned to an immutable revision. */
  documents: { documentId: string; revisionId: string; version: number; title: string }[]
  /** External material kept as text: links may need a login or change later. */
  sources: { title: string; url: string | null; content: string; retrievedAt: string }[]
  /** Decisions the team confirmed that the work must follow. */
  decisions: string[]
}

/** Immutable: a trigger rejects updates, so an agreed context can never change under a task. */
export const taskContextRevisions = pgTable(
  'task_context_revisions',
  {
    id: uuid('id').primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull(),
    manifest: jsonb('manifest').$type<ContextManifest>().notNull(),
    manifestHash: text('manifest_hash').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('task_context_revisions_no_uq').on(t.taskId, t.revisionNo)],
)
