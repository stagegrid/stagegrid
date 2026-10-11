import type {
  AnalystDocumentInput,
  FindingDto,
  QaReportInput,
  ReviewReportInput,
  RunRole,
  SubmissionInput,
  TaskState,
} from '@stagegrid/shared'
import { and, desc, eq, max } from 'drizzle-orm'

import type { Tx } from '../db/client'
import type { ContextManifest } from '../db/schema'
import {
  cells,
  documentApprovals,
  documentRevisions,
  employees,
  runs,
  stages,
  submissionReviews,
  taskContextRevisions,
  tasks,
  taskSubmissions,
} from '../db/schema'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import type { ProjectRow } from './access'
import { audit } from './audit'
import type { ServiceContext } from './context'
import { saveDocDraftCore } from './docs.service'
import { makeResolver } from './refs'
import { loadStages } from './structure'
import { loadItems } from './structure'
import { recordSubmission } from './submissions.service'
import type { TaskRow } from './task-access'
import { hashManifest } from './task-context.service'
import { moveTaskState, recordEvent } from './tasks.service'
import { resolveRoleStage } from './team.service'

type RunRow = typeof runs.$inferSelect
type SubmissionRow = typeof taskSubmissions.$inferSelect

const short = (sha: string) => sha.slice(0, 7)

async function fresh(tx: Tx, taskId: string): Promise<TaskRow> {
  const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId))
  return t!
}

async function latestContextId(tx: Tx, taskId: string): Promise<string | null> {
  const [c] = await tx
    .select({ id: taskContextRevisions.id })
    .from(taskContextRevisions)
    .where(eq(taskContextRevisions.taskId, taskId))
    .orderBy(desc(taskContextRevisions.revisionNo))
    .limit(1)
  return c?.id ?? null
}

/**
 * Queues a run of the team workflow's own making (a review, a rework, ...). These start by
 * themselves because they are steps of work a person already started or accepted, not new work.
 */
export async function queueRoleRun(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  task: TaskRow,
  o: {
    role: RunRole
    employeeId: string
    submissionId?: string | null
    taskStateBefore: TaskState
    key: string
  },
): Promise<RunRow | null> {
  const [employee] = await tx.select().from(employees).where(eq(employees.id, o.employeeId))
  const contextId = await latestContextId(tx, task.id)
  if (!employee || employee.archivedAt || !contextId) return null
  const [last] = await tx
    .select({ n: max(runs.attempt) })
    .from(runs)
    .where(eq(runs.taskId, task.id))
  const now = ctx.now()
  const [row] = await tx
    .insert(runs)
    .values({
      id: newId(),
      projectId: project.id,
      taskId: task.id,
      employeeId: employee.id,
      contextRevisionId: contextId,
      attempt: (last?.n ?? 0) + 1,
      role: o.role,
      submissionId: o.submissionId ?? null,
      state: 'queued',
      taskStateBefore: o.taskStateBefore,
      runtime: {
        provider: employee.provider,
        model: employee.model,
        instructions: employee.instructions,
      },
      startKey: o.key,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  await audit(tx, ctx, {
    projectId: project.id,
    action: 'run.queue',
    targetType: 'run',
    targetId: row!.id,
    after: { taskId: task.id, role: o.role, employeeId: employee.id, automatic: true },
  })
  await notify(tx, ctx, project.id, 'run.updated', {
    runId: row!.id,
    taskId: task.id,
    state: 'queued',
  })
  return row!
}

// ---- Dev delivery -> review -> acceptance

async function reviewerFor(tx: Tx, project: ProjectRow, task: TaskRow) {
  const t = project.team.reviewer
  if (!t.enabled || !t.employeeId || task.role !== 'dev' || t.employeeId === task.employeeId)
    return null
  const [e] = await tx.select().from(employees).where(eq(employees.id, t.employeeId))
  return e && !e.archivedAt ? e : null
}

/**
 * A Dev run delivered. With a Reviewer on the team the delivery is reviewed first; without one it goes
 * straight to the person who accepts, exactly as before the team workflow existed.
 */
export async function afterDevDelivery(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  task: TaskRow,
  run: RunRow,
  submission: SubmissionRow,
): Promise<void> {
  const reviewer = await reviewerFor(tx, project, task)
  if (!reviewer) {
    if (task.state === 'in_progress')
      await moveTaskState(
        tx,
        ctx,
        project,
        task,
        'ready_for_acceptance',
        'run_succeeded',
        `Run ${run.attempt} finished and submitted its work`,
      )
    return
  }
  await tx
    .update(taskSubmissions)
    .set({ reviewState: 'pending' })
    .where(eq(taskSubmissions.id, submission.id))
  await recordEvent(tx, ctx, task.id, {
    fromState: task.state,
    toState: task.state,
    action: 'review_requested',
    reason: `${reviewer.displayName} reviews commit ${short(submission.headCommit)}`,
  })
  await queueRoleRun(tx, ctx, project, task, {
    role: 'reviewer',
    employeeId: reviewer.id,
    submissionId: submission.id,
    taskStateBefore: task.state,
    key: `review:${submission.id}`,
  })
}

export interface Finding {
  severity: string
  text: string
  file: string | null
}

/**
 * Sends work back to Dev, within the project's rework limit. Within it, the task reopens as a new
 * round and a Dev run starts by itself; past it nothing starts and the task is marked for a person.
 */
export async function requestRework(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  devTask: TaskRow,
  source: 'reviewer' | 'qa',
  summary: string,
  qaTask?: TaskRow,
): Promise<{ limited: boolean }> {
  const limit = project.team.reworkLimit
  const who = source === 'qa' ? 'QA' : 'The Reviewer'
  if (devTask.reworkRounds >= limit) {
    const reason = `Rework limit reached (${limit} round${limit === 1 ? '' : 's'}). ${who} still found problems; a person decides what happens next.`
    if (qaTask) {
      await tx.update(tasks).set({ blockedReason: reason }).where(eq(tasks.id, qaTask.id))
      await moveTaskState(
        tx,
        ctx,
        project,
        await fresh(tx, qaTask.id),
        'draft',
        'qa_failed',
        summary || 'QA failed the accepted commit',
      )
    } else {
      await tx.update(tasks).set({ blockedReason: reason }).where(eq(tasks.id, devTask.id))
      await moveTaskState(
        tx,
        ctx,
        project,
        await fresh(tx, devTask.id),
        'changes_requested',
        'review_changes',
        summary || 'The Reviewer asked for changes',
      )
    }
    await notify(tx, ctx, project.id, 'task.updated', { taskId: (qaTask ?? devTask).id })
    return { limited: true }
  }
  await tx
    .update(tasks)
    .set({ reworkRounds: devTask.reworkRounds + 1, blockedReason: null })
    .where(eq(tasks.id, devTask.id))
  const reopened = await moveTaskState(
    tx,
    ctx,
    project,
    await fresh(tx, devTask.id),
    'changes_requested',
    source === 'qa' ? 'qa_failed' : 'review_changes',
    summary ||
      (source === 'qa' ? 'QA failed the accepted commit' : 'The Reviewer asked for changes'),
  )
  if (reopened.employeeId)
    await queueRoleRun(tx, ctx, project, reopened, {
      role: 'dev',
      employeeId: reopened.employeeId,
      taskStateBefore: 'changes_requested',
      key: `rework:${reopened.id}:${reopened.reworkRounds}`,
    })
  if (qaTask) {
    await tx
      .update(tasks)
      .set({ blockedReason: 'Waiting for the new accepted commit' })
      .where(eq(tasks.id, qaTask.id))
    await moveTaskState(
      tx,
      ctx,
      project,
      await fresh(tx, qaTask.id),
      'draft',
      'qa_failed',
      'Waiting for the new accepted commit',
    )
  }
  return { limited: false }
}

export async function recordReview(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  task: TaskRow,
  run: RunRow,
  report: ReviewReportInput,
): Promise<void> {
  const [sub] = run.submissionId
    ? await tx.select().from(taskSubmissions).where(eq(taskSubmissions.id, run.submissionId))
    : []
  if (!sub) return
  await tx.insert(submissionReviews).values({
    id: newId(),
    projectId: project.id,
    taskId: task.id,
    submissionId: sub.id,
    runId: run.id,
    role: 'reviewer',
    verdict: report.verdict,
    summary: report.summary,
    findings: report.findings,
    createdAt: ctx.now(),
  })
  if (report.verdict === 'pass') {
    await tx
      .update(taskSubmissions)
      .set({ reviewState: 'passed' })
      .where(eq(taskSubmissions.id, sub.id))
    if (task.state === 'in_progress')
      await moveTaskState(
        tx,
        ctx,
        project,
        task,
        'ready_for_acceptance',
        'review_passed',
        'The Reviewer found nothing to change',
      )
    return
  }
  await tx
    .update(taskSubmissions)
    .set({
      reviewState: 'changes_requested',
      state: 'changes_requested',
      decisionReason: report.summary || 'The Reviewer asked for changes',
      decidedAt: ctx.now(),
    })
    .where(eq(taskSubmissions.id, sub.id))
  await requestRework(tx, ctx, project, task, 'reviewer', report.summary)
}

// ---- QA

export async function recordQa(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  qaTask: TaskRow,
  run: RunRow,
  report: QaReportInput,
  runnerChecks: SubmissionInput['verification'],
): Promise<void> {
  const devTask = qaTask.parentTaskId ? await fresh(tx, qaTask.parentTaskId) : null
  const [accepted] = devTask
    ? await tx
        .select()
        .from(taskSubmissions)
        .where(and(eq(taskSubmissions.taskId, devTask.id), eq(taskSubmissions.state, 'accepted')))
        .orderBy(desc(taskSubmissions.createdAt))
        .limit(1)
    : []
  const commit = (accepted?.headCommit ?? '0000000').toLowerCase()
  const submission = await recordSubmission(
    tx,
    ctx,
    project,
    qaTask,
    run,
    {
      artifacts: [{ kind: 'commit', url: null, repo: null, branch: null, headCommit: commit }],
      verification: [
        ...runnerChecks.map((c) => ({ ...c, commit })),
        ...report.results.map((r) => ({
          command: `Criterion: ${r.criterion}`,
          exitCode: r.result === 'pass' ? 0 : 1,
          commit,
          source: 'agent_reported' as const,
          output: r.evidence || null,
        })),
      ],
    },
    report.summary,
  )
  await tx.insert(submissionReviews).values({
    id: newId(),
    projectId: project.id,
    taskId: qaTask.id,
    submissionId: submission.id,
    runId: run.id,
    role: 'qa',
    verdict: report.verdict,
    summary: report.summary,
    findings: report.findings,
    results: report.results,
    createdAt: ctx.now(),
  })
  if (report.verdict === 'pass') {
    await tx
      .update(taskSubmissions)
      .set({ reviewState: 'passed' })
      .where(eq(taskSubmissions.id, submission.id))
    if (qaTask.state === 'in_progress')
      await moveTaskState(
        tx,
        ctx,
        project,
        qaTask,
        'ready_for_acceptance',
        'qa_passed',
        'QA found no problems',
      )
    return
  }
  await tx
    .update(taskSubmissions)
    .set({
      reviewState: 'changes_requested',
      state: 'changes_requested',
      decisionReason: report.summary || 'QA failed the accepted commit',
      decidedAt: ctx.now(),
    })
    .where(eq(taskSubmissions.id, submission.id))
  if (devTask)
    await requestRework(tx, ctx, project, devTask, 'qa', report.summary, await fresh(tx, qaTask.id))
}

// ---- Analyst

/** Saves the documents an Analyst drafted and records them as the task's delivery. */
export async function recordAnalystDocuments(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  task: TaskRow,
  run: RunRow,
  docs: AnalystDocumentInput[],
  summary: string,
): Promise<SubmissionRow> {
  const [cell] = await tx.select().from(cells).where(eq(cells.id, task.cellId))
  const [stage] = await tx.select().from(stages).where(eq(stages.id, cell!.stageId))
  const earlier = await tx
    .select()
    .from(taskSubmissions)
    .where(eq(taskSubmissions.taskId, task.id))
    .orderBy(desc(taskSubmissions.createdAt))
  const artifacts: (SubmissionInput['artifacts'][number] & {
    documentId: string
    version: number
    template: string
  })[] = []
  for (const d of docs) {
    // A revision round updates the same document instead of starting another.
    const previous = earlier
      .flatMap((s) => s.artifacts)
      .find((a) => a.kind === 'document' && a.template === d.template)
    const saved = await saveDocDraftCore(ctx, project, null, {
      template: d.template,
      item: cell!.itemId,
      stage: stage!.id,
      documentId: previous?.documentId,
      title: d.title,
      draft: { sections: Object.fromEntries(d.sections.map((s) => [s.id, s.content])) },
    })
    artifacts.push({
      kind: 'document',
      url: saved.viewUrl,
      repo: null,
      branch: null,
      headCommit: `${saved.documentId}@${saved.version}`,
      documentId: saved.documentId,
      version: saved.version,
      template: d.template,
    })
  }
  return recordSubmission(tx, ctx, project, task, run, { artifacts, verification: [] }, summary)
}

// ---- Handoff after acceptance

function blockedHandoff(tx: Tx, ctx: ServiceContext, parent: TaskRow, text: string) {
  return Promise.all([
    tx.update(tasks).set({ blockedReason: text }).where(eq(tasks.id, parent.id)),
    recordEvent(tx, ctx, parent.id, {
      fromState: parent.state,
      toState: parent.state,
      action: 'handoff_blocked',
      reason: text,
    }),
  ])
}

async function nextStageCell(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  parent: TaskRow,
  role: 'dev' | 'qa',
): Promise<{ id: string; stageName: string } | { problem: string }> {
  const stageRows = await loadStages(tx, project.id)
  const stage = resolveRoleStage(project, stageRows, role)
  if (!stage)
    return {
      problem: `Couldn't create the ${role === 'qa' ? 'QA' : 'Dev'} task: no stage is set for that role.`,
    }
  const [parentCell] = await tx.select().from(cells).where(eq(cells.id, parent.cellId))
  const [cell] = await tx
    .select()
    .from(cells)
    .where(and(eq(cells.itemId, parentCell!.itemId), eq(cells.stageId, stage.id)))
  if (!cell)
    return {
      problem: `Couldn't create the ${role === 'qa' ? 'QA' : 'Dev'} task: this item has no ${stage.name} cell.`,
    }
  if (cell.progressMode === 'manual') {
    if (cell.status !== 'todo')
      return {
        problem: `Couldn't create the ${role === 'qa' ? 'QA' : 'Dev'} task: the ${stage.name} cell is already set to ${cell.status}. Switch it to follow tasks, or create the task yourself.`,
      }
    await tx
      .update(cells)
      .set({ progressMode: 'tasks', updatedAt: ctx.now() })
      .where(eq(cells.id, cell.id))
    await audit(tx, ctx, {
      projectId: project.id,
      action: 'cell.progress_mode',
      targetType: 'cell',
      targetId: cell.id,
      before: { progressMode: 'manual' },
      after: { progressMode: 'tasks', reason: 'team workflow handoff', stage: stage.name },
    })
  } else if (cell.status === 'skip') {
    return {
      problem: `Couldn't create the ${role === 'qa' ? 'QA' : 'Dev'} task: the ${stage.name} stage is skipped for this item.`,
    }
  }
  return { id: cell.id, stageName: stage.name }
}

async function pinSystemContext(
  tx: Tx,
  ctx: ServiceContext,
  taskId: string,
  manifest: ContextManifest,
): Promise<void> {
  const [last] = await tx
    .select({ n: max(taskContextRevisions.revisionNo) })
    .from(taskContextRevisions)
    .where(eq(taskContextRevisions.taskId, taskId))
  await tx.insert(taskContextRevisions).values({
    id: newId(),
    taskId,
    revisionNo: (last?.n ?? 0) + 1,
    manifest,
    manifestHash: hashManifest(manifest),
    createdBy: null,
    createdAt: ctx.now(),
  })
}

async function itemName(tx: Tx, project: ProjectRow, cellId: string): Promise<string> {
  const [cell] = await tx.select().from(cells).where(eq(cells.id, cellId))
  return makeResolver(await loadItems(tx, project.id), []).index.pathOf(cell!.itemId)
}

/**
 * After a person accepts a stage task, creates the next role's task on the item's next mapped stage,
 * carrying the agreed context and a link to what was just accepted. It happens once per accepted
 * task (a database rule), so retrying the acceptance can't create a second one. People still mark the
 * new task ready and start it.
 */
export async function handoffAfterAccept(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  task: TaskRow,
  submission: SubmissionRow,
): Promise<void> {
  if (task.role === 'analyst') {
    if (!project.team.dev.employeeId) return
    const target = await nextStageCell(tx, ctx, project, task, 'dev')
    if ('problem' in target) return void (await blockedHandoff(tx, ctx, task, target.problem))
    const path = await itemName(tx, project, task.cellId)
    const docs = submission.artifacts.filter(
      (a) => a.kind === 'document' && a.documentId && a.version,
    )
    const pinned: ContextManifest['documents'] = []
    for (const a of docs) {
      const [rev] = await tx
        .select({ id: documentRevisions.id, title: documentRevisions.title })
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.documentId, a.documentId!),
            eq(documentRevisions.version, a.version!),
          ),
        )
      if (rev)
        pinned.push({
          documentId: a.documentId!,
          revisionId: rev.id,
          version: a.version!,
          title: rev.title,
        })
    }
    const [created] = await tx
      .insert(tasks)
      .values({
        id: newId(),
        projectId: project.id,
        cellId: target.id,
        title: `Implement ${path}`,
        scope: task.scope,
        acceptanceCriteria: task.acceptanceCriteria,
        required: true,
        employeeId: project.team.dev.employeeId,
        role: 'dev',
        parentTaskId: task.id,
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
      })
      .onConflictDoNothing()
      .returning()
    if (!created) return
    await recordEvent(tx, ctx, created.id, {
      fromState: null,
      toState: 'draft',
      action: 'create',
      reason: `Handed over after "${task.title}" was accepted`,
    })
    const [prev] = await tx
      .select()
      .from(taskContextRevisions)
      .where(eq(taskContextRevisions.taskId, task.id))
      .orderBy(desc(taskContextRevisions.revisionNo))
      .limit(1)
    await pinSystemContext(tx, ctx, created.id, {
      schemaVersion: 1,
      documents: pinned,
      sources: prev?.manifest.sources ?? [],
      decisions: prev?.manifest.decisions ?? [],
    })
    await audit(tx, ctx, {
      projectId: project.id,
      action: 'task.handoff',
      targetType: 'task',
      targetId: created.id,
      after: { from: task.id, role: 'dev' },
    })
    await notify(tx, ctx, project.id, 'task.updated', { taskId: created.id, cellId: target.id })
    return
  }
  if (task.role === 'dev' && project.team.qa.enabled && project.team.qa.employeeId) {
    const target = await nextStageCell(tx, ctx, project, task, 'qa')
    if ('problem' in target) return void (await blockedHandoff(tx, ctx, task, target.problem))
    const [prev] = await tx
      .select()
      .from(taskContextRevisions)
      .where(eq(taskContextRevisions.taskId, task.id))
      .orderBy(desc(taskContextRevisions.revisionNo))
      .limit(1)
    const pr = submission.artifacts.find((a) => a.kind === 'pull_request')
    const manifest: ContextManifest = {
      schemaVersion: 1,
      documents: prev?.manifest.documents ?? [],
      decisions: prev?.manifest.decisions ?? [],
      sources: [
        ...(prev?.manifest.sources ?? []).filter((s) => s.title !== 'Accepted delivery'),
        {
          title: 'Accepted delivery',
          url: pr?.url ?? null,
          content: `Commit ${submission.headCommit}\n${submission.summary}`.trim(),
          retrievedAt: ctx.now().toISOString(),
        },
      ],
    }
    const path = await itemName(tx, project, task.cellId)
    const [created] = await tx
      .insert(tasks)
      .values({
        id: newId(),
        projectId: project.id,
        cellId: target.id,
        title: `Test ${path}`,
        scope: task.scope,
        acceptanceCriteria: task.acceptanceCriteria,
        required: true,
        employeeId: project.team.qa.employeeId,
        role: 'qa',
        parentTaskId: task.id,
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
      })
      .onConflictDoNothing()
      .returning()
    if (created) {
      await recordEvent(tx, ctx, created.id, {
        fromState: null,
        toState: 'draft',
        action: 'create',
        reason: `Handed over after "${task.title}" was accepted`,
      })
      await pinSystemContext(tx, ctx, created.id, manifest)
      await audit(tx, ctx, {
        projectId: project.id,
        action: 'task.handoff',
        targetType: 'task',
        targetId: created.id,
        after: { from: task.id, role: 'qa' },
      })
      await notify(tx, ctx, project.id, 'task.updated', { taskId: created.id, cellId: target.id })
      return
    }
    // The QA task exists from an earlier acceptance: re-arm it for the new commit instead of making another.
    const [existing] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, task.id), eq(tasks.role, 'qa')))
    if (existing && existing.state === 'draft') {
      await tx.update(tasks).set({ blockedReason: null }).where(eq(tasks.id, existing.id))
      await pinSystemContext(tx, ctx, existing.id, manifest)
      await recordEvent(tx, ctx, existing.id, {
        fromState: 'draft',
        toState: 'draft',
        action: 'handoff',
        reason: `Ready to test the new commit ${short(submission.headCommit)}`,
      })
      await notify(tx, ctx, project.id, 'task.updated', {
        taskId: existing.id,
        cellId: existing.cellId,
      })
    }
  }
}

/** Approves the documents of an accepted Analyst delivery: accepting it is approving those revisions. */
export async function approveAnalystDocuments(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  submission: SubmissionRow,
  approvedBy: string,
): Promise<void> {
  for (const a of submission.artifacts) {
    if (a.kind !== 'document' || !a.documentId || !a.version) continue
    const [live] = await tx
      .select({ id: documentApprovals.id })
      .from(documentApprovals)
      .where(
        and(
          eq(documentApprovals.documentId, a.documentId),
          eq(documentApprovals.version, a.version),
        ),
      )
    if (live) continue
    await tx.insert(documentApprovals).values({
      id: newId(),
      projectId: project.id,
      documentId: a.documentId,
      version: a.version,
      approvedBy,
      approvedAt: ctx.now(),
      note: 'Accepted with the analyst task',
    })
    await audit(tx, ctx, {
      projectId: project.id,
      action: 'document.approve',
      targetType: 'document',
      targetId: a.documentId,
      after: { version: a.version },
    })
  }
}

/** What a Reviewer or QA sent back, for the Dev picking the work up again. */
export async function feedbackFor(
  tx: Tx,
  task: TaskRow,
): Promise<{ source: string; summary: string; findings: FindingDto[] }[]> {
  const out: { source: string; summary: string; findings: FindingDto[]; at: Date }[] = []
  const own = await tx
    .select()
    .from(submissionReviews)
    .where(
      and(
        eq(submissionReviews.taskId, task.id),
        eq(submissionReviews.verdict, 'changes_requested'),
      ),
    )
  for (const r of own)
    out.push({ source: 'reviewer', summary: r.summary, findings: r.findings, at: r.createdAt })
  const qa = await tx
    .select({ r: submissionReviews })
    .from(submissionReviews)
    .innerJoin(tasks, eq(tasks.id, submissionReviews.taskId))
    .where(and(eq(tasks.parentTaskId, task.id), eq(submissionReviews.verdict, 'fail')))
  for (const { r } of qa)
    out.push({
      source: 'qa',
      summary: r.summary,
      findings: [
        ...r.findings,
        ...r.results
          .filter((x) => x.result !== 'pass')
          .map((x) => ({
            severity: 'major',
            text: `Criterion not met: ${x.criterion}. ${x.evidence}`.trim(),
            file: null,
          })),
      ],
      at: r.createdAt,
    })
  // The most recent round only: earlier ones were already addressed.
  out.sort((a, b) => a.at.getTime() - b.at.getTime())
  const last = out.slice(-1)
  return last.map(({ at: _at, ...rest }) => rest)
}
