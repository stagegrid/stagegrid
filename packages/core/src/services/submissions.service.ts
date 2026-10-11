import type { ReviewDto, SubmissionDto, SubmissionInput } from '@stagegrid/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'

import type { DbOrTx, Tx } from '../db/client'
import { type runs, submissionReviews, taskArtifacts, taskSubmissions, users } from '../db/schema'
import { artifactRef, summarizeChecks } from '../domain/delivery'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import type { ProjectRow } from './access'
import { audit } from './audit'
import type { ServiceContext } from './context'
import type { TaskRow } from './task-access'

type SubmissionRow = typeof taskSubmissions.$inferSelect
type RunRow = typeof runs.$inferSelect

export function toReviewDto(r: typeof submissionReviews.$inferSelect): ReviewDto {
  return {
    id: r.id,
    role: r.role as ReviewDto['role'],
    verdict: r.verdict,
    summary: r.summary,
    findings: r.findings,
    results: r.results,
    runId: r.runId,
    createdAt: r.createdAt.toISOString(),
  }
}

export function toSubmissionDto(
  s: SubmissionRow,
  decidedBy: string | null,
  reviews: ReviewDto[] = [],
): SubmissionDto {
  return {
    id: s.id,
    runId: s.runId,
    state: s.state,
    headCommit: s.headCommit,
    summary: s.summary,
    contextRevisionId: s.contextRevisionId,
    artifacts: s.artifacts.map((a) => ({
      ...a,
      kind: a.kind as SubmissionDto['artifacts'][number]['kind'],
    })),
    checks: s.verification,
    evidence: summarizeChecks(s.verification, s.headCommit),
    createdAt: s.createdAt.toISOString(),
    decidedAt: s.decidedAt?.toISOString() ?? null,
    decidedBy,
    decisionReason: s.decisionReason,
    reviewState: s.reviewState,
    reviews,
  }
}

/** The latest submission of each task. */
export async function latestSubmissions(
  db: DbOrTx,
  taskIds: string[],
): Promise<Map<string, SubmissionDto>> {
  const out = new Map<string, SubmissionDto>()
  if (taskIds.length === 0) return out
  const rows = await db
    .select({ s: taskSubmissions, name: users.name })
    .from(taskSubmissions)
    .leftJoin(users, eq(users.id, taskSubmissions.decidedBy))
    .where(inArray(taskSubmissions.taskId, taskIds))
    .orderBy(desc(taskSubmissions.createdAt), desc(taskSubmissions.id))
  const latest = new Map<string, { s: SubmissionRow; name: string | null }>()
  for (const r of rows) if (!latest.has(r.s.taskId)) latest.set(r.s.taskId, r)
  const reviews = latest.size
    ? await db
        .select()
        .from(submissionReviews)
        .where(
          inArray(
            submissionReviews.submissionId,
            [...latest.values()].map((r) => r.s.id),
          ),
        )
    : []
  for (const [taskId, { s, name }] of latest)
    out.set(
      taskId,
      toSubmissionDto(s, name, reviews.filter((r) => r.submissionId === s.id).map(toReviewDto)),
    )
  return out
}

/**
 * Records what a run delivered. Artifacts are stored once per task (a retry that reports the same
 * pull request reuses it), and earlier open submissions are superseded, so an acceptance of an old
 * commit can never cover this new one.
 */
export async function recordSubmission(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  task: TaskRow,
  run: RunRow,
  input: SubmissionInput,
  summary: string,
): Promise<SubmissionRow> {
  const now = ctx.now()
  const artifacts: SubmissionRow['artifacts'] = []
  for (const a of input.artifacts) {
    const ref = artifactRef(a)
    await tx
      .insert(taskArtifacts)
      .values({
        id: newId(),
        projectId: project.id,
        taskId: task.id,
        kind: a.kind,
        externalRef: ref,
        url: a.url,
        repo: a.repo,
        branch: a.branch,
        firstRunId: run.id,
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [taskArtifacts.taskId, taskArtifacts.kind, taskArtifacts.externalRef],
      })
    const [row] = await tx
      .select()
      .from(taskArtifacts)
      .where(
        and(
          eq(taskArtifacts.taskId, task.id),
          eq(taskArtifacts.kind, a.kind),
          eq(taskArtifacts.externalRef, ref),
        ),
      )
    const doc = a as typeof a & { documentId?: string; version?: number; template?: string }
    artifacts.push({
      artifactId: row!.id,
      kind: a.kind,
      url: a.url,
      repo: a.repo,
      branch: a.branch,
      headCommit: a.headCommit,
      ...(doc.documentId
        ? { documentId: doc.documentId, version: doc.version, template: doc.template }
        : {}),
    })
  }
  await tx
    .update(taskSubmissions)
    .set({ state: 'superseded' })
    .where(and(eq(taskSubmissions.taskId, task.id), eq(taskSubmissions.state, 'submitted')))
  const [row] = await tx
    .insert(taskSubmissions)
    .values({
      id: newId(),
      projectId: project.id,
      taskId: task.id,
      runId: run.id,
      contextRevisionId: run.contextRevisionId,
      headCommit: input.artifacts[0]!.headCommit.toLowerCase(),
      summary,
      artifacts,
      verification: input.verification.map((v) => ({
        command: v.command,
        exitCode: v.exitCode,
        commit: v.commit.toLowerCase(),
        source: v.source,
        output: v.output,
      })),
      createdAt: now,
    })
    .returning()
  await audit(tx, ctx, {
    projectId: project.id,
    action: 'submission.record',
    targetType: 'task_submission',
    targetId: row!.id,
    after: { runId: run.id, headCommit: row!.headCommit, artifacts: artifacts.length },
  })
  await notify(tx, ctx, project.id, 'task.updated', { taskId: task.id, cellId: task.cellId })
  return row!
}
