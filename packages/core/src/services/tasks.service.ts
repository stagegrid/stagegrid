import type {
  BoardTaskDto,
  CellProgressMode,
  CreateContextInput,
  CreateTaskInput,
  EmployeeRefDto,
  SubmissionDto,
  TaskActionInput,
  TaskContextDto,
  TaskContextSummaryDto,
  TaskDetailDto,
  TaskDto,
  TaskRunSummaryDto,
  TaskState,
  UpdateTaskInput,
} from '@stagegrid/shared'
import { ACTIVE_RUN_STATES, LIMITS } from '@stagegrid/shared'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import type { DbOrTx, Tx } from '../db/client'
import {
  cellEvents,
  cells,
  employees,
  items,
  projectMembers,
  runners,
  runs,
  stages,
  taskEvents,
  tasks,
  taskSubmissions,
  users,
} from '../db/schema'
import { aggregateCellStatus, availableActions, resolveTransition } from '../domain/tasks'
import { conflict, invalid, notFound } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireProjectRole } from './access'
import { audit } from './audit'
import { loadEvents, recomputeCell } from './changes.service'
import { type ServiceContext, withTx } from './context'
import { requireActiveEmployee } from './employees.service'
import { cellStale } from './project-stats'
import { makeResolver } from './refs'
import { loadItems, loadStages } from './structure'
import { latestSubmissions } from './submissions.service'
import { loadTaskInProject, lockTask, type TaskRow } from './task-access'
import {
  createContextRevision,
  getContextOrThrow,
  latestContexts,
  readinessReasons,
} from './task-context.service'
import { cancelRunRows, isActiveRunRow } from './work-cancel'

type CellRow = typeof cells.$inferSelect

interface TaskLookups {
  owners: Map<string, string>
  employees: Map<string, EmployeeRefDto>
  contexts: Map<string, TaskContextSummaryDto>
  runs: Map<string, TaskRunSummaryDto>
  submissions: Map<string, SubmissionDto>
}

async function loadLookups(db: DbOrTx, rows: TaskRow[]): Promise<TaskLookups> {
  const userIds = [...new Set(rows.flatMap((t) => (t.ownerUserId ? [t.ownerUserId] : [])))]
  const employeeIds = [...new Set(rows.flatMap((t) => (t.employeeId ? [t.employeeId] : [])))]
  const [owners, staff, contexts, runRows, submissions] = await Promise.all([
    userIds.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : [],
    employeeIds.length
      ? db
          .select({
            id: employees.id,
            displayName: employees.displayName,
            role: employees.role,
            avatar: employees.avatar,
          })
          .from(employees)
          .where(inArray(employees.id, employeeIds))
      : [],
    latestContexts(
      db,
      rows.map((t) => t.id),
    ),
    rows.length
      ? db
          .select({ run: runs, runnerName: runners.name })
          .from(runs)
          .leftJoin(runners, eq(runners.id, runs.runnerId))
          .where(
            inArray(
              runs.taskId,
              rows.map((t) => t.id),
            ),
          )
          .orderBy(desc(runs.attempt))
      : [],
    latestSubmissions(
      db,
      rows.map((t) => t.id),
    ),
  ])
  const latestRuns = new Map<string, TaskRunSummaryDto>()
  for (const { run, runnerName } of runRows) {
    if (latestRuns.has(run.taskId)) continue
    latestRuns.set(run.taskId, {
      id: run.id,
      role: run.role,
      state: run.state,
      attempt: run.attempt,
      runnerName,
      failureReason: run.failureReason,
      resumeAt: run.resumeAt?.toISOString() ?? null,
      updatedAt: run.updatedAt.toISOString(),
    })
  }
  return {
    owners: new Map(owners.map((u) => [u.id, u.name])),
    employees: new Map(staff.map((e) => [e.id, e])),
    contexts,
    runs: latestRuns,
    submissions,
  }
}

function toTaskDto(t: TaskRow, lookups: TaskLookups): TaskDto {
  return {
    id: t.id,
    role: t.role,
    reworkRounds: t.reworkRounds,
    blockedReason: t.blockedReason,
    parentTaskId: t.parentTaskId,
    cellId: t.cellId,
    title: t.title,
    scope: t.scope,
    acceptanceCriteria: t.acceptanceCriteria,
    required: t.required,
    state: t.state,
    version: t.version,
    owner: t.ownerUserId
      ? { userId: t.ownerUserId, name: lookups.owners.get(t.ownerUserId) ?? 'Unknown' }
      : null,
    employee: t.employeeId ? (lookups.employees.get(t.employeeId) ?? null) : null,
    context: lookups.contexts.get(t.id) ?? null,
    run: lookups.runs.get(t.id) ?? null,
    submission: lookups.submissions.get(t.id) ?? null,
    // An employee's task is started and submitted by its runs, not by hand.
    actions: availableActions(t.state).filter(
      (a) => !(t.employeeId && (a === 'start' || a === 'submit' || a === 'accept')),
    ),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }
}

interface CellContext {
  cell: CellRow
  itemId: string
  itemPath: string
  stageName: string
}

async function loadCellContext(
  db: DbOrTx,
  project: ProjectRow,
  cellId: string,
): Promise<CellContext> {
  const [row] = await db
    .select({ cell: cells, stageName: stages.name })
    .from(cells)
    .innerJoin(items, eq(items.id, cells.itemId))
    .innerJoin(stages, eq(stages.id, cells.stageId))
    .where(and(eq(cells.id, cellId), eq(items.projectId, project.id)))
  if (!row) throw notFound('Cell not found')
  const itemPath = makeResolver(await loadItems(db, project.id), []).index.pathOf(row.cell.itemId)
  return { cell: row.cell, itemId: row.cell.itemId, itemPath, stageName: row.stageName }
}

async function assertMember(db: DbOrTx, projectId: string, userId: string): Promise<void> {
  const [m] = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  if (!m) {
    // Admins can act in every project but only members can own work.
    throw invalid(`User ${userId} is not a member of this project`)
  }
}

/**
 * Brings a task-managed cell's status in line with its tasks by appending a cell event, so history,
 * rounds and rework counting keep working exactly as for manual edits. Cells that are manual or
 * skipped are left alone: skipping is an explicit decision.
 */
export async function syncCellFromTasks(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  cellId: string,
  reason: string,
): Promise<CellRow> {
  const [cell] = await tx.select().from(cells).where(eq(cells.id, cellId))
  if (!cell) throw notFound('Cell not found')
  if (cell.progressMode !== 'tasks' || cell.status === 'skip') return cell
  const rows = await tx.select().from(tasks).where(eq(tasks.cellId, cellId))
  const target = aggregateCellStatus(rows)
  if (target === cell.status) return cell

  const now = ctx.now()
  await tx.insert(cellEvents).values({
    id: newId(),
    cellId,
    toStatus: target,
    happenedAt: now,
    recordedAt: now,
    actorUserId: ctx.actor?.userId ?? null,
    via: ctx.actor?.via ?? 'system',
    reason: reason.slice(0, LIMITS.reason),
  })
  const events = (await loadEvents(tx, [cellId])).get(cellId) ?? []
  const updated = await recomputeCell(tx, cellId, events, now)
  const cx = await loadCellContext(tx, project, cellId)
  await audit(tx, ctx, {
    projectId: project.id,
    action: 'cell.status',
    targetType: 'cell',
    targetId: cellId,
    before: { status: cell.status },
    after: {
      status: updated.status,
      toStatus: target,
      reason,
      item: cx.itemPath,
      stage: cx.stageName,
      via: 'tasks',
    },
  })
  await notify(tx, ctx, project.id, 'cell.updated', {
    cellId,
    itemId: updated.itemId,
    stageId: updated.stageId,
    status: updated.status,
    fromStatus: cell.status,
    rework: updated.reworkCount,
    stale: cellStale(updated, project, now),
    itemPath: cx.itemPath,
    stageName: cx.stageName,
  })
  return updated
}

export async function setCellProgressMode(
  ctx: ServiceContext,
  ref: string,
  cellId: string,
  mode: CellProgressMode,
): Promise<{ cellId: string; progressMode: CellProgressMode; status: string }> {
  // Going back to manual is the owner's call: it frees the cell from its tasks' bookkeeping.
  const { project } = await requireProjectRole(ctx, ref, mode === 'manual' ? 'owner' : 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const cx = await loadCellContext(tx, project, cellId)
    if (cx.cell.progressMode === mode) return { cellId, progressMode: mode, status: cx.cell.status }
    if (mode === 'tasks' && cx.cell.status === 'skip')
      throw conflict(
        'This stage is skipped for this item. Un-skip it before managing it with tasks.',
      )
    await tx
      .update(cells)
      .set({ progressMode: mode, updatedAt: ctx.now() })
      .where(eq(cells.id, cellId))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'cell.progress_mode',
      targetType: 'cell',
      targetId: cellId,
      before: { progressMode: cx.cell.progressMode },
      after: { progressMode: mode, item: cx.itemPath, stage: cx.stageName },
    })
    let status = cx.cell.status
    if (mode === 'tasks') {
      // Only follow the tasks once some exist, so switching a finished cell doesn't silently reopen it.
      const existing = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.cellId, cellId))
        .limit(1)
      if (existing.length)
        status = (await syncCellFromTasks(tx, txCtx, project, cellId, 'Switched to task progress'))
          .status
    }
    await notify(tx, txCtx, project.id, 'cell.detail_updated', { cellId })
    return { cellId, progressMode: mode, status }
  })
}

export async function listTasks(
  ctx: ServiceContext,
  ref: string,
  filter: { state?: TaskState; cellId?: string } = {},
): Promise<BoardTaskDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const rows = await ctx.db
    .select({ t: tasks, cell: cells, stageName: stages.name })
    .from(tasks)
    .innerJoin(cells, eq(cells.id, tasks.cellId))
    .innerJoin(stages, eq(stages.id, cells.stageId))
    .where(
      and(
        eq(tasks.projectId, project.id),
        filter.state ? eq(tasks.state, filter.state) : undefined,
        filter.cellId ? eq(tasks.cellId, filter.cellId) : undefined,
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
  const lookups = await loadLookups(
    ctx.db,
    rows.map((r) => r.t),
  )
  const resolver = makeResolver(
    await loadItems(ctx.db, project.id),
    await loadStages(ctx.db, project.id),
  )
  return rows.map(({ t, cell, stageName }) => ({
    ...toTaskDto(t, lookups),
    itemId: cell.itemId,
    itemPath: resolver.index.pathOf(cell.itemId),
    stageId: cell.stageId,
    stageName,
  }))
}

async function toDetail(db: DbOrTx, project: ProjectRow, t: TaskRow): Promise<TaskDetailDto> {
  const cx = await loadCellContext(db, project, t.cellId)
  const [lookups, events] = await Promise.all([
    loadLookups(db, [t]),
    db
      .select({ e: taskEvents, actorName: users.name })
      .from(taskEvents)
      .leftJoin(users, eq(users.id, taskEvents.actorUserId))
      .where(eq(taskEvents.taskId, t.id))
      .orderBy(asc(taskEvents.createdAt), asc(taskEvents.id)),
  ])
  return {
    ...toTaskDto(t, lookups),
    itemId: cx.itemId,
    itemPath: cx.itemPath,
    stageId: cx.cell.stageId,
    stageName: cx.stageName,
    events: events.map(({ e, actorName }) => ({
      id: e.id,
      fromState: e.fromState,
      toState: e.toState,
      action: e.action,
      actor: { userId: e.actorUserId, name: actorName ?? 'System', via: e.via },
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}

export async function getTask(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
): Promise<TaskDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  return toDetail(ctx.db, project, await loadTaskInProject(ctx.db, project, taskId))
}

export function recordEvent(
  tx: DbOrTx,
  ctx: ServiceContext,
  taskId: string,
  e: { fromState: TaskState | null; toState: TaskState; action: string; reason?: string | null },
) {
  return tx.insert(taskEvents).values({
    id: newId(),
    taskId,
    fromState: e.fromState,
    toState: e.toState,
    action: e.action,
    actorUserId: ctx.actor?.userId ?? null,
    via: ctx.actor?.via ?? 'system',
    reason: e.reason ?? null,
    createdAt: ctx.now(),
  })
}

export async function createTask(
  ctx: ServiceContext,
  ref: string,
  input: CreateTaskInput,
): Promise<TaskDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const cx = await loadCellContext(tx, project, input.cellId)
    if (cx.cell.progressMode !== 'tasks')
      throw conflict('Switch this cell to task progress before adding tasks to it.')
    if (cx.cell.status === 'skip')
      throw conflict('This stage is skipped for this item. Un-skip it before adding tasks.')
    const [counted] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.cellId, input.cellId))
    if ((counted?.n ?? 0) >= LIMITS.tasksPerCell)
      throw invalid(`A cell can have at most ${LIMITS.tasksPerCell} tasks`)
    if (input.ownerUserId) await assertMember(tx, project.id, input.ownerUserId)
    const assigned = input.employeeId
      ? await requireActiveEmployee(tx, project, input.employeeId)
      : null
    if (assigned?.role === 'reviewer')
      throw invalid("A Reviewer checks the Dev's delivery; they don't take tasks of their own.")

    const now = ctx.now()
    const id = newId()
    const [row] = await tx
      .insert(tasks)
      .values({
        id,
        projectId: project.id,
        cellId: input.cellId,
        title: input.title,
        scope: input.scope,
        acceptanceCriteria: input.acceptanceCriteria,
        required: input.required,
        ownerUserId: input.ownerUserId,
        employeeId: input.employeeId,
        role: assigned ? (assigned.role as 'analyst' | 'dev' | 'qa') : null,
        createdBy: ctx.actor!.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    await recordEvent(tx, txCtx, id, { fromState: null, toState: 'draft', action: 'create' })
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'task.create',
      targetType: 'task',
      targetId: id,
      after: {
        title: input.title,
        required: input.required,
        item: cx.itemPath,
        stage: cx.stageName,
      },
    })
    // A new required task holds a finished cell back, so the cell may need to reopen.
    await syncCellFromTasks(tx, txCtx, project, input.cellId, `Task "${input.title}" added`)
    await notify(tx, txCtx, project.id, 'task.updated', { taskId: id, cellId: input.cellId })
    return toDetail(tx, project, row!)
  })
}

export async function updateTask(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const current = await loadTaskInProject(tx, project, taskId)
    if (current.state === 'done' || current.state === 'cancelled')
      throw conflict(
        `A ${current.state === 'done' ? 'finished' : 'cancelled'} task can't be edited. Reopen or restore it first.`,
      )
    if (input.ownerUserId) await assertMember(tx, project.id, input.ownerUserId)
    let roleFromEmployee: 'analyst' | 'dev' | 'qa' | null | undefined
    if (input.employeeId !== undefined && input.employeeId !== current.employeeId) {
      if (!['draft', 'ready', 'changes_requested'].includes(current.state))
        throw conflict(
          "Work is under way, so it can't be reassigned now. Cancel or finish it first.",
        )
      if (input.employeeId) {
        const e = await requireActiveEmployee(tx, project, input.employeeId)
        if (e.role === 'reviewer')
          throw invalid("A Reviewer checks the Dev's delivery; they don't take tasks of their own.")
        roleFromEmployee = e.role as 'analyst' | 'dev' | 'qa'
      } else roleFromEmployee = null
    }
    const patch = {
      title: input.title,
      scope: input.scope,
      acceptanceCriteria: input.acceptanceCriteria,
      required: input.required,
      ownerUserId: input.ownerUserId,
      employeeId: input.employeeId,
    }
    const changed = Object.entries(patch).filter(([, v]) => v !== undefined)
    if (changed.length === 0) throw invalid('Nothing to change')
    const [row] = await tx
      .update(tasks)
      .set({
        ...patch,
        ...(roleFromEmployee !== undefined ? { role: roleFromEmployee } : {}),
        version: current.version + 1,
        updatedAt: ctx.now(),
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, input.expectedVersion)))
      .returning()
    if (!row) throw staleVersion(current.version)
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'task.update',
      targetType: 'task',
      targetId: taskId,
      before: Object.fromEntries(changed.map(([k]) => [k, current[k as keyof TaskRow]])),
      after: Object.fromEntries(changed),
    })
    if (input.required !== undefined && input.required !== current.required) {
      await syncCellFromTasks(
        tx,
        txCtx,
        project,
        row.cellId,
        `Task "${row.title}" is now ${row.required ? 'required' : 'optional'}`,
      )
    }
    await notify(tx, txCtx, project.id, 'task.updated', { taskId, cellId: row.cellId })
    return toDetail(tx, project, row)
  })
}

function staleVersion(currentVersion: number) {
  return conflict('This task changed since you loaded it. Reload and try again.', {
    code: 'stale_version',
    currentVersion,
  })
}

/**
 * Moves a task between states on behalf of the system (a run being claimed, finished or cancelled).
 * Same bookkeeping as a person's action: version, event, audit, cell status and realtime.
 */
export async function moveTaskState(
  tx: Tx,
  ctx: ServiceContext,
  project: ProjectRow,
  current: TaskRow,
  to: TaskState,
  action: string,
  reason: string,
): Promise<TaskRow> {
  const [row] = await tx
    .update(tasks)
    .set({ state: to, version: current.version + 1, updatedAt: ctx.now() })
    .where(and(eq(tasks.id, current.id), eq(tasks.version, current.version)))
    .returning()
  if (!row) throw staleVersion(current.version)
  await recordEvent(tx, ctx, current.id, {
    fromState: current.state,
    toState: to,
    action,
    reason,
  })
  await audit(tx, ctx, {
    projectId: project.id,
    action: `task.${action}`,
    targetType: 'task',
    targetId: current.id,
    before: { state: current.state },
    after: { state: to, reason },
  })
  await syncCellFromTasks(tx, ctx, project, row.cellId, `Task "${row.title}": ${reason}`)
  await notify(tx, ctx, project.id, 'task.updated', { taskId: row.id, cellId: row.cellId })
  return row
}

const ACTION_VERB: Record<TaskActionInput['action'], string> = {
  mark_ready: 'marked ready',
  start: 'started',
  submit: 'submitted for acceptance',
  accept: 'accepted',
  request_changes: 'sent back for changes',
  reopen: 'reopened',
  cancel: 'cancelled',
  restore: 'restored',
}

export async function transitionTask(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
  input: TaskActionInput,
): Promise<TaskDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const current = await loadTaskInProject(tx, project, taskId)
    const t = resolveTransition(input.action, current.state)
    if (!t.ok)
      throw conflict(
        `Can't ${input.action.replace('_', ' ')} a task that is ${current.state.replace(/_/g, ' ')}.`,
        { code: 'invalid_transition', state: current.state, allowedFrom: t.allowedFrom },
      )
    if (current.employeeId && (input.action === 'start' || input.action === 'submit'))
      throw conflict(
        input.action === 'start'
          ? 'This task is assigned to an AI employee. Start a run instead.'
          : "An AI employee submits its own work. Cancel the run if it can't finish.",
        { code: 'employee_task' },
      )
    if (current.employeeId && input.action === 'accept')
      throw conflict(
        "Accept an AI employee's work against its delivery: review the commit and accept that exact version.",
        { code: 'employee_task' },
      )
    if (t.reasonRequired && !input.reason)
      throw invalid('Say why: a reason is required for this action')
    if (input.action === 'mark_ready') {
      const reasons = await readinessReasons(tx, project, current)
      if (reasons.length)
        throw invalid(`This task isn't ready: ${reasons.join(' ')}`, { code: 'not_ready', reasons })
    }
    if (input.action === 'cancel') {
      // Cancelling a task stops its work too: lock the task, then end any run and open questions.
      await lockTask(tx, taskId)
      const [active] = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.taskId, taskId), inArray(runs.state, [...ACTIVE_RUN_STATES])))
        .for('update')
      if (active && isActiveRunRow(active))
        await cancelRunRows(tx, active, ctx.now(), 'The task was cancelled')
    }
    if (input.action === 'restore') {
      const cx = await loadCellContext(tx, project, current.cellId)
      if (cx.cell.progressMode !== 'tasks' || cx.cell.status === 'skip')
        throw conflict("This cell isn't managed by tasks, so the task can't be restored.")
    }
    const [row] = await tx
      .update(tasks)
      .set({ state: t.to, version: current.version + 1, updatedAt: ctx.now() })
      .where(and(eq(tasks.id, taskId), eq(tasks.version, input.expectedVersion)))
      .returning()
    if (!row) throw staleVersion(current.version)
    await recordEvent(tx, txCtx, taskId, {
      fromState: current.state,
      toState: t.to,
      action: input.action,
      reason: input.reason,
    })
    if (input.action === 'request_changes')
      // The delivery that was reviewed is sent back; a new run will deliver a new submission.
      await tx
        .update(taskSubmissions)
        .set({
          state: 'changes_requested',
          decidedBy: ctx.actor?.userId ?? null,
          decidedAt: ctx.now(),
          decisionReason: input.reason ?? null,
        })
        .where(and(eq(taskSubmissions.taskId, taskId), eq(taskSubmissions.state, 'submitted')))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: `task.${input.action}`,
      targetType: 'task',
      targetId: taskId,
      before: { state: current.state },
      after: { state: t.to, reason: input.reason ?? null },
    })
    const why = input.reason ? `: ${input.reason}` : ''
    await syncCellFromTasks(
      tx,
      txCtx,
      project,
      row.cellId,
      `Task "${row.title}" ${ACTION_VERB[input.action]}${why}`,
    )
    await notify(tx, txCtx, project.id, 'task.updated', { taskId, cellId: row.cellId })
    return toDetail(tx, project, row)
  })
}

export async function getContext(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
  revisionId?: string,
): Promise<TaskContextDto> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  await loadTaskInProject(ctx.db, project, taskId)
  return getContextOrThrow(ctx.db, taskId, revisionId)
}

export function pinContext(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
  input: CreateContextInput,
): Promise<TaskContextDto> {
  return createContextRevision(ctx, ref, taskId, input)
}
