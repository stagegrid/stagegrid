import type { AcceptTaskInput, TaskDetailDto } from '@stagegrid/shared'
import { and, desc, eq } from 'drizzle-orm'

import { taskSubmissions } from '../db/schema'
import { sameCommit, summarizeChecks } from '../domain/delivery'
import { conflict, notFound } from '../errors'
import { notify } from '../realtime/notify'
import { requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'
import { approveAnalystDocuments, handoffAfterAccept } from './flow.service'
import { toSubmissionDto } from './submissions.service'
import { loadTaskInProject, lockTask } from './task-access'
import { getTask, moveTaskState } from './tasks.service'

/**
 * A person accepts an employee's delivery. The decision is bound to the exact submission, commit
 * and context they reviewed: if a newer delivery replaced it, or the commit or context isn't the
 * one they saw, nothing is accepted. Accepting records the decision, finishes the task and lets the
 * cell recompute; it does not merge anything. Repeating the same acceptance is a no-op.
 */
export async function acceptTask(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
  input: AcceptTaskInput,
): Promise<TaskDetailDto> {
  const { project, actor } = await requireProjectRole(ctx, ref, 'editor')
  await withTx(ctx, async (tx, txCtx) => {
    await loadTaskInProject(tx, project, taskId)
    const task = await lockTask(tx, taskId)
    const [submission] = await tx
      .select()
      .from(taskSubmissions)
      .where(and(eq(taskSubmissions.id, input.submissionId), eq(taskSubmissions.taskId, taskId)))
      .for('update')
    if (!submission) throw notFound('Submission not found')

    if (submission.state === 'accepted' && submission.acceptKey === input.idempotencyKey) return
    if (submission.state === 'superseded')
      throw conflict('A newer delivery replaced the one you reviewed. Review the latest.', {
        code: 'submission_changed',
      })
    if (submission.state !== 'submitted')
      throw conflict(`This delivery was already ${submission.state.replace('_', ' ')}.`, {
        code: 'submission_closed',
        state: submission.state,
      })
    if (task.state !== 'ready_for_acceptance')
      throw conflict('This task is not waiting for acceptance.', {
        code: 'invalid_state',
        state: task.state,
      })
    if (task.version !== input.expectedVersion)
      throw conflict('This task changed since you loaded it. Reload and try again.', {
        code: 'stale_version',
        currentVersion: task.version,
      })
    if (!sameCommit(submission.headCommit, input.headCommit))
      throw conflict('The delivered commit is not the one you reviewed.', {
        code: 'commit_changed',
      })
    if (submission.contextRevisionId !== input.contextRevisionId)
      throw conflict('The context this was built from is not the one you reviewed.', {
        code: 'context_changed',
      })
    const evidence = summarizeChecks(submission.verification, submission.headCommit)
    if (evidence.failing > 0 && !input.acknowledgeFailing)
      throw conflict(
        `${evidence.failing} check${evidence.failing === 1 ? '' : 's'} failed on this commit. Confirm to accept anyway.`,
        { code: 'evidence_failing', failing: evidence.failing },
      )

    const now = ctx.now()
    await tx
      .update(taskSubmissions)
      .set({
        state: 'accepted',
        acceptKey: input.idempotencyKey,
        acceptedCommit: submission.headCommit,
        decidedBy: actor.userId,
        decidedAt: now,
      })
      .where(eq(taskSubmissions.id, submission.id))
    // Accepting an Analyst's delivery is approving the requirement revisions in it.
    if (task.role === 'analyst')
      await approveAnalystDocuments(tx, txCtx, project, submission, actor.userId)
    const accepted = await moveTaskState(
      tx,
      txCtx,
      project,
      task,
      'done',
      'accept',
      task.role === 'analyst'
        ? 'Accepted the requirements'
        : `Accepted commit ${submission.headCommit.slice(0, 7)}`,
    )
    await handoffAfterAccept(tx, txCtx, project, accepted, submission)
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'submission.accept',
      targetType: 'task_submission',
      targetId: submission.id,
      after: {
        commit: submission.headCommit,
        contextRevisionId: submission.contextRevisionId,
        acknowledgedFailing: input.acknowledgeFailing && evidence.failing > 0,
      },
    })
    await notify(tx, txCtx, project.id, 'task.updated', { taskId, cellId: task.cellId })
  })
  return getTask(ctx, ref, taskId)
}

/** The submissions of a task, newest first (for the delivery history). */
export async function listSubmissions(ctx: ServiceContext, ref: string, taskId: string) {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  await loadTaskInProject(ctx.db, project, taskId)
  const rows = await ctx.db
    .select()
    .from(taskSubmissions)
    .where(eq(taskSubmissions.taskId, taskId))
    .orderBy(desc(taskSubmissions.createdAt))
  return rows.map((r) => toSubmissionDto(r, null))
}
