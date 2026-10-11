import type {
  AnswerQuestionInput,
  AskQuestionsInput,
  CreateContextInput,
  QuestionBatchDto,
  TaskContextDto,
} from '@stagegrid/shared'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'

import type { DbOrTx, Tx } from '../db/client'
import { projects, questionBatches, questions, runs, tasks, users } from '../db/schema'
import { conflict, invalid, notFound } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'
import type { RunnerRow } from './runners.service'
import { loadTaskInProject, lockTask } from './task-access'
import { createContextRevision } from './task-context.service'
import { moveTaskState } from './tasks.service'

type BatchRow = typeof questionBatches.$inferSelect

const staleLease = (current: number) =>
  conflict('This run was cancelled, replaced or timed out. Stop working on it.', {
    code: 'stale_fencing',
    currentFencingToken: current,
  })

async function toBatchDto(db: DbOrTx, batch: BatchRow): Promise<QuestionBatchDto> {
  const rows = await db
    .select({ q: questions, name: users.name })
    .from(questions)
    .leftJoin(users, eq(users.id, questions.answeredBy))
    .where(eq(questions.batchId, batch.id))
    .orderBy(asc(questions.position))
  return {
    id: batch.id,
    taskId: batch.taskId,
    runId: batch.runId,
    contextRevisionId: batch.contextRevisionId,
    state: batch.state,
    holdForContext: batch.holdForContext,
    createdAt: batch.createdAt.toISOString(),
    closedAt: batch.closedAt?.toISOString() ?? null,
    questions: rows.map(({ q, name }) => ({
      id: q.id,
      position: q.position,
      prompt: q.prompt,
      options: q.options,
      state: q.state,
      answer: q.answer,
      changesScope: q.changesScope,
      answeredBy: q.answeredBy ? { userId: q.answeredBy, name: name ?? 'Unknown' } : null,
      answeredAt: q.answeredAt?.toISOString() ?? null,
    })),
  }
}

export async function listBatches(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
): Promise<QuestionBatchDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  await loadTaskInProject(ctx.db, project, taskId)
  const rows = await ctx.db
    .select()
    .from(questionBatches)
    .where(eq(questionBatches.taskId, taskId))
    .orderBy(desc(questionBatches.createdAt))
  return Promise.all(rows.map((b) => toBatchDto(ctx.db, b)))
}

/**
 * The employee is blocked and asks, all at once. The run stops where it is (its claim is revoked)
 * and waits; the task shows it is waiting for an answer. Asking again with the same key returns the
 * same batch, and a task can have only one batch open.
 */
export async function askQuestions(
  ctx: ServiceContext,
  runner: RunnerRow,
  runId: string,
  input: AskQuestionsInput,
): Promise<QuestionBatchDto> {
  return withTx(ctx, async (tx, txCtx) => {
    const [found] = await tx.select().from(runs).where(eq(runs.id, runId))
    if (!found || found.runnerId !== runner.id) throw notFound('Run not found')
    const task = await lockTask(tx, found.taskId)
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for('update')
    if (!run) throw notFound('Run not found')

    const [again] = await tx
      .select()
      .from(questionBatches)
      .where(
        and(eq(questionBatches.runId, runId), eq(questionBatches.askKey, input.idempotencyKey)),
      )
    if (again) return toBatchDto(tx, again)

    if (run.fencingToken !== input.fencingToken || run.state !== 'running')
      throw staleLease(run.fencingToken)
    if (run.contextRevisionId !== input.contextRevisionId)
      throw conflict(
        'These questions are about a different context than the run was started with.',
        {
          code: 'context_changed',
        },
      )
    const [open] = await tx
      .select({ id: questionBatches.id })
      .from(questionBatches)
      .where(and(eq(questionBatches.taskId, task.id), eq(questionBatches.state, 'open')))
    if (open)
      throw conflict('This task already has questions waiting for an answer.', {
        code: 'batch_open',
      })

    const now = ctx.now()
    const [project] = await tx.select().from(projects).where(eq(projects.id, task.projectId))
    const [batch] = await tx
      .insert(questionBatches)
      .values({
        id: newId(),
        taskId: task.id,
        runId,
        contextRevisionId: run.contextRevisionId,
        askKey: input.idempotencyKey,
        createdAt: now,
      })
      .returning()
    await tx.insert(questions).values(
      input.questions.map((q, i) => ({
        id: newId(),
        batchId: batch!.id,
        taskId: task.id,
        position: i + 1,
        prompt: q.prompt,
        options: q.options,
        createdAt: now,
      })),
    )
    await tx
      .update(runs)
      .set({
        state: 'waiting_for_answer',
        fencingToken: run.fencingToken + 1,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(eq(runs.id, runId))
    if (task.state === 'in_progress')
      await moveTaskState(
        tx,
        txCtx,
        project!,
        task,
        'waiting_for_answer',
        'ask',
        `Asked ${input.questions.length} question${input.questions.length === 1 ? '' : 's'}`,
      )
    await audit(tx, txCtx, {
      projectId: task.projectId,
      action: 'question.ask',
      targetType: 'question_batch',
      targetId: batch!.id,
      after: { runId, count: input.questions.length },
    })
    await notify(tx, txCtx, task.projectId, 'question.updated', {
      taskId: task.id,
      batchId: batch!.id,
    })
    await notify(tx, txCtx, task.projectId, 'run.updated', {
      runId,
      taskId: task.id,
      state: 'waiting_for_answer',
    })
    return toBatchDto(tx, batch!)
  })
}

/**
 * A person answers one question. The answer is stored before anything else happens; when it was
 * the last open one the run is queued to continue, exactly once. A repeated answer (same key) is a
 * no-op, a different answer to a closed question is refused, and a cancelled batch accepts nothing.
 */
export async function answerQuestion(
  ctx: ServiceContext,
  ref: string,
  questionId: string,
  input: AnswerQuestionInput,
): Promise<QuestionBatchDto> {
  const { project, actor } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const [q0] = await tx.select().from(questions).where(eq(questions.id, questionId))
    if (!q0) throw notFound('Question not found')
    const task = await lockTask(tx, q0.taskId)
    if (task.projectId !== project.id) throw notFound('Question not found')
    const [batch] = await tx
      .select()
      .from(questionBatches)
      .where(eq(questionBatches.id, q0.batchId))
      .for('update')
    const [q] = await tx.select().from(questions).where(eq(questions.id, questionId)).for('update')
    if (!batch || !q) throw notFound('Question not found')

    if (q.state === 'answered') {
      if (q.answerKey === input.idempotencyKey && q.answer === input.answer)
        return toBatchDto(tx, batch)
      throw conflict('This question was already answered.', { code: 'already_answered' })
    }
    if (q.state === 'cancelled' || batch.state === 'cancelled')
      throw conflict('These questions were cancelled. The work they belonged to was stopped.', {
        code: 'question_cancelled',
      })
    if (input.changesScope && input.answer.trim().length === 0) throw invalid('Say what changed')

    const now = ctx.now()
    await tx
      .update(questions)
      .set({
        state: 'answered',
        answer: input.answer,
        changesScope: input.changesScope,
        answeredBy: actor.userId,
        answeredAt: now,
        answerKey: input.idempotencyKey,
      })
      .where(eq(questions.id, questionId))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'question.answer',
      targetType: 'question',
      targetId: questionId,
      after: { changesScope: input.changesScope },
    })

    const remaining = await tx
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.batchId, batch.id), eq(questions.state, 'open')))
    let updated = batch
    if (remaining.length === 0) {
      const anyScope = (
        await tx
          .select({ c: questions.changesScope })
          .from(questions)
          .where(eq(questions.batchId, batch.id))
      ).some((r) => r.c)
      const [closed] = await tx
        .update(questionBatches)
        .set({ state: 'answered', closedAt: now, holdForContext: anyScope })
        .where(eq(questionBatches.id, batch.id))
        .returning()
      updated = closed!
      if (!anyScope) await queueContinuation(tx, txCtx, project, task.id, batch.runId, null)
    }
    await notify(tx, txCtx, project.id, 'question.updated', { taskId: task.id, batchId: batch.id })
    return toBatchDto(tx, updated)
  })
}

/** Puts the waiting run back in the queue and the task back in progress. Runs once per batch. */
async function queueContinuation(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  taskId: string,
  runId: string,
  newContextRevisionId: string | null,
): Promise<void> {
  const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for('update')
  // A cancelled or already continued run is left alone: this is what makes the continuation single.
  if (!run || run.state !== 'waiting_for_answer') return
  const now = ctx.now()
  await tx
    .update(runs)
    .set({
      state: 'queued',
      resumeAt: null,
      updatedAt: now,
      ...(newContextRevisionId ? { contextRevisionId: newContextRevisionId } : {}),
    })
    .where(eq(runs.id, runId))
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId))
  if (task && task.state === 'waiting_for_answer')
    await moveTaskState(tx, ctx, project, task, 'in_progress', 'answered', 'All questions answered')
  await notify(tx, ctx, project.id, 'run.updated', { runId, taskId, state: 'queued' })
}

/**
 * Pins a new context and, if answers to a scope-changing question were waiting for it, lets the
 * work continue from the new context. The employee never swaps context by itself.
 */
export async function pinContextAndRelease(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
  input: CreateContextInput,
): Promise<TaskContextDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const revision = await createContextRevision(txCtx, ref, taskId, input)
    await lockTask(tx, taskId)
    const held = await tx
      .select()
      .from(questionBatches)
      .where(
        and(
          eq(questionBatches.taskId, taskId),
          eq(questionBatches.state, 'answered'),
          eq(questionBatches.holdForContext, true),
        ),
      )
    for (const batch of held) {
      await tx
        .update(questionBatches)
        .set({ holdForContext: false })
        .where(eq(questionBatches.id, batch.id))
      await queueContinuation(tx, txCtx, project, taskId, batch.runId, revision.revisionId)
    }
    return revision
  })
}

/** Answers people gave to a task's questions, oldest first, for the employee to continue from. */
export async function answeredQuestions(
  db: DbOrTx,
  taskId: string,
): Promise<{ question: string; answer: string }[]> {
  const rows = await db
    .select({ prompt: questions.prompt, answer: questions.answer })
    .from(questions)
    .where(and(eq(questions.taskId, taskId), inArray(questions.state, ['answered'])))
    .orderBy(asc(questions.answeredAt), asc(questions.position))
  return rows.map((r) => ({ question: r.prompt, answer: r.answer ?? '' }))
}
