import type { EvidenceSource } from '@stagegrid/shared'
import { index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'
import { reviewState, submissionState } from './enums'
import { projects } from './projects'
import { runs } from './runs'
import { taskContextRevisions, tasks } from './tasks'

const ts = (name: string) => timestamp(name, { withTimezone: true })

/** A deliverable's identity (a pull request, a pushed branch, a commit), recorded once per task. */
export const taskArtifacts = pgTable(
  'task_artifacts',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** The PR URL, `repo#branch`, or commit hash: what makes a retry the same artifact. */
    externalRef: text('external_ref').notNull(),
    url: text('url'),
    repo: text('repo'),
    branch: text('branch'),
    firstRunId: uuid('first_run_id').references(() => runs.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('task_artifacts_ref_uq').on(t.taskId, t.kind, t.externalRef)],
)

export interface SubmissionArtifact {
  /** For a requirements document: which one, and which version of it. */
  documentId?: string
  version?: number
  /** For a document: the template key it was drafted from. */
  template?: string
  artifactId: string
  kind: string
  url: string | null
  repo: string | null
  branch: string | null
  headCommit: string
}

export interface SubmissionCheck {
  command: string
  exitCode: number
  commit: string
  source: EvidenceSource
  /** The tail of the output, for the reader; not trusted as proof. */
  output: string | null
}

/**
 * What a run delivered: the commit, where it lives and the checks run against it. A run's success
 * is not acceptance: a person decides, bound to this exact commit and context.
 */
export const taskSubmissions = pgTable(
  'task_submissions',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    contextRevisionId: uuid('context_revision_id')
      .notNull()
      .references(() => taskContextRevisions.id),
    headCommit: text('head_commit').notNull(),
    summary: text('summary').notNull().default(''),
    artifacts: jsonb('artifacts').$type<SubmissionArtifact[]>().notNull(),
    verification: jsonb('verification').$type<SubmissionCheck[]>().notNull(),
    state: submissionState('state').notNull().default('submitted'),
    /** Where the Reviewer is: none (off), pending, passed or sent back. */
    reviewState: reviewState('review_state').notNull().default('none'),
    acceptKey: text('accept_key'),
    acceptedCommit: text('accepted_commit'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('task_submissions_run_uq').on(t.runId),
    index('task_submissions_task_idx').on(t.taskId, t.createdAt),
  ],
)

export interface Finding {
  severity: string
  text: string
  file: string | null
}

/** What a Reviewer or QA concluded about one delivery. Never an approval: people accept. */
export const submissionReviews = pgTable(
  'submission_reviews',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => taskSubmissions.id),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id),
    role: text('role').notNull(),
    verdict: text('verdict').notNull(),
    summary: text('summary').notNull().default(''),
    findings: jsonb('findings').$type<Finding[]>().notNull().default([]),
    /** QA: the result for each acceptance criterion. */
    results: jsonb('results')
      .$type<{ criterion: string; result: string; evidence: string }[]>()
      .notNull()
      .default([]),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('submission_reviews_run_uq').on(t.runId),
    index('submission_reviews_sub_idx').on(t.submissionId),
  ],
)
