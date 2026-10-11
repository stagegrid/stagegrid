import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './auth'
import { employees } from './employees'
import { runState, taskState } from './enums'
import { projects } from './projects'
import { taskContextRevisions, tasks } from './tasks'

const ts = (name: string) => timestamp(name, { withTimezone: true })

/** A machine that executes work. It has its own revocable credential, never a person's token. */
export const runners = pgTable(
  'runners',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    credentialHash: text('credential_hash').notNull().unique(),
    credentialPrefix: text('credential_prefix').notNull(),
    /** Providers the runner reports it can drive, e.g. ["claude_code","codex"]. */
    providers: jsonb('providers').$type<string[]>().notNull().default([]),
    version: text('version'),
    maxConcurrent: integer('max_concurrent').notNull().default(1),
    lastSeenAt: ts('last_seen_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('runners_seen_idx').on(t.lastSeenAt)],
)

/** Projects a runner may take work from. */
export const runnerProjects = pgTable(
  'runner_projects',
  {
    runnerId: uuid('runner_id')
      .notNull()
      .references(() => runners.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.runnerId, t.projectId] })],
)

/** A one-time token an admin hands to a runner; it is exchanged for the runner's own credential. */
export const runnerEnrollments = pgTable('runner_enrollments', {
  id: uuid('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  name: text('name').notNull(),
  projectIds: jsonb('project_ids').$type<string[]>().notNull().default([]),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  runnerId: uuid('runner_id').references(() => runners.id),
})

/**
 * One execution attempt of a task. Queued rows are the durable dispatch record: a runner finds work
 * by reading them, so recording the run and making it available are one atomic write.
 */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    contextRevisionId: uuid('context_revision_id')
      .notNull()
      .references(() => taskContextRevisions.id),
    attempt: integer('attempt').notNull(),
    state: runState('state').notNull().default('queued'),
    /** The task state to return to if the run is cancelled before finishing. */
    taskStateBefore: taskState('task_state_before').notNull(),
    /** The employee's runtime when the run started; later edits don't change a run in flight. */
    runtime: jsonb('runtime')
      .$type<{ provider: string; model: string | null; instructions: string }>()
      .notNull(),
    startKey: text('start_key').notNull(),
    runnerId: uuid('runner_id').references(() => runners.id),
    claimKey: text('claim_key'),
    /** Goes up on every claim and cancel; a report carrying an older token is rejected. */
    fencingToken: integer('fencing_token').notNull().default(0),
    leaseExpiresAt: ts('lease_expires_at'),
    /** The provider's session handle, so the same session can continue after a pause. */
    sessionRef: text('session_ref'),
    /** For waiting_for_capacity: when the provider's limit resets and the run can continue. */
    resumeAt: ts('resume_at'),
    lastSequence: integer('last_sequence').notNull().default(0),
    summary: text('summary'),
    failureReason: text('failure_reason'),
    completionKey: text('completion_key'),
    requestedBy: uuid('requested_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    claimedAt: ts('claimed_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('runs_task_idx').on(t.taskId, t.attempt),
    index('runs_queue_idx').on(t.projectId, t.state),
    unique('runs_task_start_key_uq').on(t.taskId, t.startKey),
    // One execution in flight per task, enforced by the database.
    uniqueIndex('runs_one_active_per_task_uq')
      .on(t.taskId)
      .where(sql`${t.state} in ('queued','running','waiting_for_answer','waiting_for_capacity')`),
  ],
)

/** Everything a runner reports, deduplicated by eventId and ordered by sequence. */
export const runEvents = pgTable(
  'run_events',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    sequence: integer('sequence').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    unique('run_events_event_uq').on(t.runId, t.eventId),
    unique('run_events_sequence_uq').on(t.runId, t.sequence),
  ],
)
