import type { AttentionItemDto, EmployeeRefDto, ThreadItemDto } from '@stagegrid/shared'
import { and, asc, desc, eq, inArray, isNotNull, or } from 'drizzle-orm'

import {
  cells,
  employees,
  questionBatches,
  questions,
  runEvents,
  runs,
  stages,
  submissionReviews,
  taskEvents,
  tasks,
  users,
} from '../db/schema'
import { requireProjectRole } from './access'
import type { ServiceContext } from './context'
import { makeResolver } from './refs'
import { loadItems } from './structure'
import { latestSubmissions } from './submissions.service'
import { loadTaskInProject } from './task-access'

const ACTION_TEXT: Record<string, string> = {
  create: 'created the task',
  mark_ready: 'marked it ready',
  start: 'started it',
  submit: 'submitted it for acceptance',
  accept: 'accepted it',
  request_changes: 'asked for changes',
  reopen: 'reopened it',
  cancel: 'cancelled it',
  restore: 'restored it',
  claim: 'Run started',
  run_succeeded: 'Run finished and submitted its work',
  run_cancelled: 'Run cancelled',
  ask: 'Asked questions',
  review_requested: 'Review requested',
  review_passed: 'Review passed',
  review_changes: 'The Reviewer asked for changes: a new round started',
  qa_passed: 'QA passed',
  qa_failed: 'QA failed the accepted commit: the work was reopened',
  handoff: 'Handed over',
  handoff_blocked: "Couldn't create the next task",
  answered: 'All questions answered; the run continues',
}

/**
 * The conversation of one task: what people did, what the employee reported, the questions it asked
 * and the answers. Details that are only useful when debugging (logs) are flagged so the reader can
 * keep them folded.
 */
export async function getThread(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
): Promise<ThreadItemDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const task = await loadTaskInProject(ctx.db, project, taskId)
  const [events, runRows, batches, answerers] = await Promise.all([
    ctx.db
      .select({ e: taskEvents, name: users.name })
      .from(taskEvents)
      .leftJoin(users, eq(users.id, taskEvents.actorUserId))
      .where(eq(taskEvents.taskId, taskId)),
    ctx.db.select().from(runs).where(eq(runs.taskId, taskId)),
    ctx.db.select().from(questionBatches).where(eq(questionBatches.taskId, taskId)),
    ctx.db.select({ id: users.id, name: users.name }).from(users),
  ])
  const employee = task.employeeId
    ? (
        await ctx.db
          .select({ name: employees.displayName })
          .from(employees)
          .where(eq(employees.id, task.employeeId))
      )[0]
    : undefined
  const empName = employee?.name ?? 'AI employee'
  const personName = new Map(answerers.map((u) => [u.id, u.name]))
  const items: ThreadItemDto[] = []

  for (const { e, name } of events) {
    const system = e.via === 'system'
    items.push({
      id: `t:${e.id}`,
      kind: 'task_event',
      at: e.createdAt.toISOString(),
      actor: { name: system ? 'Stagegrid' : (name ?? 'Someone'), via: e.via, isEmployee: false },
      text: ACTION_TEXT[e.action] ?? e.action,
      detail: e.reason,
    })
  }
  const runIds = runRows.map((r) => r.id)
  if (runIds.length) {
    const rows = await ctx.db
      .select()
      .from(runEvents)
      .where(and(inArray(runEvents.runId, runIds), inArray(runEvents.type, ['progress', 'log'])))
      .orderBy(asc(runEvents.recordedAt))
    for (const r of rows) {
      const message = typeof r.payload.message === 'string' ? r.payload.message : ''
      if (!message) continue
      items.push({
        id: `r:${r.id}`,
        kind: r.type === 'log' ? 'log' : 'progress',
        at: r.recordedAt.toISOString(),
        actor: { name: empName, via: 'system', isEmployee: true },
        text: message,
        detail: null,
      })
    }
  }
  const batchIds = batches.map((b) => b.id)
  if (batchIds.length) {
    const qs = await ctx.db
      .select()
      .from(questions)
      .where(inArray(questions.batchId, batchIds))
      .orderBy(asc(questions.position))
    for (const q of qs) {
      const batch = batches.find((b) => b.id === q.batchId)!
      items.push({
        id: `q:${q.id}`,
        kind: 'question',
        at: q.createdAt.toISOString(),
        actor: { name: empName, via: 'system', isEmployee: true },
        text: q.prompt,
        detail: q.options.length ? `Options: ${q.options.join(' · ')}` : null,
      })
      if (q.state === 'answered' && q.answeredAt)
        items.push({
          id: `a:${q.id}`,
          kind: 'answer',
          at: q.answeredAt.toISOString(),
          actor: {
            name: personName.get(q.answeredBy ?? '') ?? 'Someone',
            via: 'web',
            isEmployee: false,
          },
          text: q.answer ?? '',
          detail: q.changesScope ? 'Changes what was agreed: waiting for a new context' : null,
        })
      if (q.state === 'cancelled')
        items.push({
          id: `x:${q.id}`,
          kind: 'task_event',
          at: (batch.closedAt ?? q.createdAt).toISOString(),
          actor: { name: 'Stagegrid', via: 'system', isEmployee: false },
          text: `Question cancelled: ${q.prompt}`,
          detail: null,
        })
    }
  }
  const reviews = await ctx.db
    .select()
    .from(submissionReviews)
    .where(eq(submissionReviews.taskId, taskId))
  for (const r of reviews) {
    const lines = r.findings.map((f) => `${f.severity}: ${f.text}${f.file ? ` (${f.file})` : ''}`)
    const results = r.results.map((x) => `${x.result === 'pass' ? '✓' : '✗'} ${x.criterion}`)
    items.push({
      id: `v:${r.id}`,
      kind: 'review',
      at: r.createdAt.toISOString(),
      actor: { name: r.role === 'qa' ? 'QA' : 'Reviewer', via: 'system', isEmployee: true },
      text: `${r.role === 'qa' ? 'QA' : 'Review'}: ${r.verdict === 'pass' ? 'passed' : r.verdict === 'fail' ? 'failed' : 'changes requested'}${r.summary ? `. ${r.summary}` : ''}`,
      detail: [...results, ...lines].join('\n') || null,
    })
  }
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
}

/** What needs a person right now: questions to answer and runs that stopped with a problem. */
export async function getAttention(ctx: ServiceContext, ref: string): Promise<AttentionItemDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const rows = await ctx.db
    .select({ t: tasks, cell: cells, stageName: stages.name })
    .from(tasks)
    .innerJoin(cells, eq(cells.id, tasks.cellId))
    .innerJoin(stages, eq(stages.id, cells.stageId))
    .where(
      and(
        eq(tasks.projectId, project.id),
        or(
          isNotNull(tasks.blockedReason),
          eq(tasks.state, 'changes_requested'),
          eq(tasks.state, 'draft'),
          eq(tasks.state, 'waiting_for_answer'),
          eq(tasks.state, 'in_progress'),
          eq(tasks.state, 'ready_for_acceptance'),
        ),
      ),
    )
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.t.id)
  const subs = await latestSubmissions(ctx.db, ids)
  const [latestRuns, openBatches, staff] = await Promise.all([
    ctx.db.select().from(runs).where(inArray(runs.taskId, ids)).orderBy(desc(runs.attempt)),
    ctx.db
      .select()
      .from(questionBatches)
      .where(and(inArray(questionBatches.taskId, ids), eq(questionBatches.state, 'open'))),
    ctx.db
      .select({
        id: employees.id,
        displayName: employees.displayName,
        role: employees.role,
        avatar: employees.avatar,
      })
      .from(employees)
      .where(eq(employees.projectId, project.id)),
  ])
  const employeeRef = new Map<string, EmployeeRefDto>(staff.map((e) => [e.id, e]))
  const resolver = makeResolver(await loadItems(ctx.db, project.id), [])
  const batchQuestions = openBatches.length
    ? await ctx.db
        .select()
        .from(questions)
        .where(
          inArray(
            questions.batchId,
            openBatches.map((b) => b.id),
          ),
        )
        .orderBy(asc(questions.position))
    : []
  const out: AttentionItemDto[] = []
  for (const { t, cell, stageName } of rows) {
    const base = {
      taskId: t.id,
      taskTitle: t.title,
      itemPath: resolver.index.pathOf(cell.itemId),
      stageName,
      employee: t.employeeId ? (employeeRef.get(t.employeeId) ?? null) : null,
    }
    if (
      t.blockedReason?.startsWith('Rework limit') ||
      t.blockedReason?.startsWith("Couldn't create")
    ) {
      out.push({
        ...base,
        kind: t.blockedReason.startsWith('Rework limit') ? 'rework_limit' : 'handoff_blocked',
        at: t.updatedAt.toISOString(),
        summary: t.blockedReason,
      })
      continue
    }
    if (t.state === 'ready_for_acceptance') {
      const sub = subs.get(t.id)
      out.push({
        ...base,
        kind: 'acceptance',
        at: sub?.createdAt ?? t.updatedAt.toISOString(),
        summary: sub
          ? `Delivered commit ${sub.headCommit.slice(0, 7)}${sub.summary ? `: ${sub.summary.split('\n')[0]}` : ''}`
          : 'Waiting for your decision.',
      })
      continue
    }
    const batch = openBatches.find((b) => b.taskId === t.id)
    if (batch) {
      const qs = batchQuestions.filter((q) => q.batchId === batch.id && q.state === 'open')
      out.push({
        ...base,
        kind: 'question',
        at: batch.createdAt.toISOString(),
        summary:
          qs.length > 1
            ? `${qs.length} questions waiting. First: ${qs[0]?.prompt}`
            : (qs[0]?.prompt ?? ''),
      })
      continue
    }
    const run = latestRuns.find((r) => r.taskId === t.id)
    if (t.state === 'in_progress' && run && (run.state === 'failed' || run.state === 'interrupted'))
      out.push({
        ...base,
        kind: 'run_problem',
        at: (run.finishedAt ?? run.updatedAt).toISOString(),
        summary: run.failureReason ?? 'The run stopped.',
      })
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1))
}
