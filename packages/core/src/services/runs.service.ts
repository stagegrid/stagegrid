import type {
  ClaimedRunDto,
  ClaimRunInput,
  CompleteRunInput,
  QueuedRunDto,
  RunDto,
  RunEventInput,
  StartRunInput,
} from '@stagegrid/shared'
import { ACTIVE_RUN_STATES, MAX_CAPACITY_RESUMES } from '@stagegrid/shared'
import { and, asc, desc, eq, inArray, lt, max, sql } from 'drizzle-orm'

import type { DbOrTx, Tx } from '../db/client'
import {
  employees,
  projects,
  runEvents,
  runnerProjects,
  runners,
  runs,
  taskContextRevisions,
  tasks,
} from '../db/schema'
import { capacityBlock, ceilingsFor } from '../domain/capacity'
import { isClaimable, leaseDeadline } from '../domain/runs'
import { conflict, notFound } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'
import { revisionMarkdown } from './docs.service'
import { answeredQuestions } from './questions.service'
import { eligibleRunnerExists, type RunnerRow } from './runners.service'
import { loadTaskInProject, lockTask, type TaskRow } from './task-access'
import { getContextOrThrow, readinessReasons } from './task-context.service'
import { moveTaskState } from './tasks.service'
import { cancelRunRows } from './work-cancel'

type RunRow = typeof runs.$inferSelect

const STARTABLE: ReadonlySet<string> = new Set(['ready', 'changes_requested'])

const staleFencing = (current: number) =>
  conflict('This run was cancelled, replaced or timed out. Stop working on it.', {
    code: 'stale_fencing',
    currentFencingToken: current,
  })

function toRunDto(r: RunRow, runnerName: string | null): RunDto {
  return {
    id: r.id,
    taskId: r.taskId,
    employeeId: r.employeeId,
    contextRevisionId: r.contextRevisionId,
    state: r.state,
    attempt: r.attempt,
    runnerName,
    runtime: { provider: r.runtime.provider, model: r.runtime.model },
    summary: r.summary,
    failureReason: r.failureReason,
    resumeAt: r.resumeAt?.toISOString() ?? null,
    leaseExpiresAt: r.leaseExpiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    claimedAt: r.claimedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }
}

async function runnerName(db: DbOrTx, id: string | null): Promise<string | null> {
  if (!id) return null
  const [r] = await db.select({ name: runners.name }).from(runners).where(eq(runners.id, id))
  return r?.name ?? null
}

async function projectOf(db: DbOrTx, projectId: string): Promise<ProjectRow> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!p) throw notFound('Project not found')
  return p
}

// ---- people: start, cancel, list

export async function listRuns(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
): Promise<RunDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  await loadTaskInProject(ctx.db, project, taskId)
  const rows = await ctx.db
    .select({ run: runs, name: runners.name })
    .from(runs)
    .leftJoin(runners, eq(runners.id, runs.runnerId))
    .where(eq(runs.taskId, taskId))
    .orderBy(desc(runs.attempt))
  return rows.map((r) => toRunDto(r.run, r.name))
}

/**
 * Queues a run for an employee's task. Recording the run is also making it available to runners,
 * so there is no separate dispatch step that could be lost. The same idempotency key returns the
 * same run, and the database allows only one run in flight per task.
 */
export async function startRun(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
  input: StartRunInput,
): Promise<RunDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    await loadTaskInProject(tx, project, taskId)
    const task = await lockTask(tx, taskId)

    const [prior] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.taskId, taskId), eq(runs.startKey, input.idempotencyKey)))
    if (prior) {
      if (prior.contextRevisionId !== input.contextRevisionId)
        throw conflict('This idempotency key was already used with a different context.', {
          code: 'idempotency_conflict',
        })
      return toRunDto(prior, await runnerName(tx, prior.runnerId))
    }

    if (!task.employeeId)
      throw conflict('Assign an AI employee to this task before starting a run.')
    const [active] = await tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.taskId, taskId), inArray(runs.state, [...ACTIVE_RUN_STATES])))
    if (active)
      throw conflict('A run is already in progress for this task.', { code: 'run_active' })

    const [last] = await tx
      .select({ state: runs.state, attempt: runs.attempt })
      .from(runs)
      .where(eq(runs.taskId, taskId))
      .orderBy(desc(runs.attempt))
      .limit(1)
    const retry =
      task.state === 'in_progress' && last && ['failed', 'interrupted'].includes(last.state)
    if (!STARTABLE.has(task.state) && !retry)
      throw conflict(
        `A ${task.state.replace(/_/g, ' ')} task can't be started. It needs to be ready or have changes requested.`,
        { code: 'invalid_state', state: task.state },
      )
    if (task.version !== input.expectedVersion)
      throw conflict('This task changed since you loaded it. Reload and try again.', {
        code: 'stale_version',
        currentVersion: task.version,
      })

    const [latestCtx] = await tx
      .select({ id: taskContextRevisions.id })
      .from(taskContextRevisions)
      .where(eq(taskContextRevisions.taskId, taskId))
      .orderBy(desc(taskContextRevisions.revisionNo))
      .limit(1)
    if (!latestCtx) throw conflict('Pin the context before starting.', { code: 'not_ready' })
    if (latestCtx.id !== input.contextRevisionId)
      throw conflict('The pinned context changed. Review it and start again.', {
        code: 'context_changed',
        latestContextRevisionId: latestCtx.id,
      })
    const reasons = await readinessReasons(tx, project, task)
    if (reasons.length)
      throw conflict(`This task isn't ready: ${reasons.join(' ')}`, { code: 'not_ready', reasons })

    const [employee] = await tx.select().from(employees).where(eq(employees.id, task.employeeId))
    if (!employee || employee.archivedAt)
      throw conflict(
        `${employee?.displayName ?? 'The employee'} is archived and can't take new work.`,
      )
    const now = ctx.now()
    if (!(await eligibleRunnerExists(tx, project.id, employee.provider, now)))
      throw conflict(
        'No runner is online for this project and provider. Start a runner, then try again.',
        { code: 'runner_unavailable', provider: employee.provider },
      )

    const [{ lastAttempt } = { lastAttempt: null }] = await tx
      .select({ lastAttempt: max(runs.attempt) })
      .from(runs)
      .where(eq(runs.taskId, taskId))
    const [row] = await tx
      .insert(runs)
      .values({
        id: newId(),
        projectId: project.id,
        taskId,
        employeeId: employee.id,
        contextRevisionId: latestCtx.id,
        attempt: (lastAttempt ?? 0) + 1,
        state: 'queued',
        taskStateBefore: task.state,
        runtime: {
          provider: employee.provider,
          model: employee.model,
          instructions: employee.instructions,
        },
        startKey: input.idempotencyKey,
        requestedBy: ctx.actor!.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'run.queue',
      targetType: 'run',
      targetId: row!.id,
      after: { taskId, attempt: row!.attempt, employeeId: employee.id },
    })
    await notify(tx, txCtx, project.id, 'run.updated', { runId: row!.id, taskId, state: 'queued' })
    await notify(tx, txCtx, project.id, 'task.updated', { taskId, cellId: task.cellId })
    return toRunDto(row!, null)
  })
}

/**
 * Stops a run: the claim is revoked (the fencing token moves on), so anything the runner still
 * sends is refused. A task that hadn't been accepted goes back to where it was.
 */
export async function cancelRun(
  ctx: ServiceContext,
  ref: string,
  runId: string,
  reason?: string,
): Promise<RunDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const [found] = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.projectId, project.id)))
    if (!found) throw notFound('Run not found')
    const task = await lockTask(tx, found.taskId)
    const [current] = await tx.select().from(runs).where(eq(runs.id, runId)).for('update')
    if (!current || !ACTIVE_RUN_STATES.includes(current.state))
      throw conflict('This run has already finished.', {
        code: 'run_finished',
        state: current?.state,
      })
    const now = ctx.now()
    const row = await cancelRunRows(tx, current, now, reason ?? null)
    if (
      (task.state === 'in_progress' || task.state === 'waiting_for_answer') &&
      current.taskStateBefore !== 'in_progress'
    )
      await moveTaskState(
        tx,
        txCtx,
        project,
        task,
        current.taskStateBefore,
        'run_cancelled',
        reason ? `Run cancelled: ${reason}` : 'Run cancelled',
      )
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'run.cancel',
      targetType: 'run',
      targetId: runId,
      before: { state: current.state },
      after: { reason: reason ?? null },
    })
    await notify(tx, txCtx, project.id, 'run.updated', {
      runId,
      taskId: task.id,
      state: 'cancelled',
    })
    await notify(tx, txCtx, project.id, 'task.updated', { taskId: task.id, cellId: task.cellId })
    return toRunDto(row, await runnerName(tx, row.runnerId))
  })
}

// ---- runners: queue, claim, heartbeat, events, complete

async function grantedProjectIds(db: DbOrTx, runnerId: string): Promise<string[]> {
  const grants = await db
    .select({ projectId: runnerProjects.projectId })
    .from(runnerProjects)
    .where(eq(runnerProjects.runnerId, runnerId))
  return grants.map((g) => g.projectId)
}

/** Work this runner could claim. Reading the queue doesn't reserve anything; claiming does. */
export async function runnerQueue(ctx: ServiceContext, runner: RunnerRow): Promise<QueuedRunDto[]> {
  const granted = await grantedProjectIds(ctx.db, runner.id)
  if (granted.length === 0 || runner.providers.length === 0) return []
  const rows = await ctx.db
    .select({ run: runs, title: tasks.title })
    .from(runs)
    .innerJoin(tasks, eq(tasks.id, runs.taskId))
    .where(
      and(
        inArray(runs.projectId, granted),
        inArray(runs.state, ['queued', 'waiting_for_capacity']),
        sql`${runs.runtime}->>'provider' in (${sql.join(
          runner.providers.map((p) => sql`${p}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(asc(runs.createdAt), asc(runs.id))
    .limit(50)
  const now = ctx.now()
  // Above the ceiling, new work stays queued; it is offered again as soon as the usage drops or resets.
  const blocked = (provider: string) =>
    capacityBlock(runner.capacity[provider], ceilingsFor(runner.ceilings, provider), now) !== null
  return rows
    .filter(({ run }) => isClaimable(run, now) && !blocked(run.runtime.provider))
    .map(({ run, title }) => ({
      id: run.id,
      projectId: run.projectId,
      taskTitle: title,
      attempt: run.attempt,
      provider: run.runtime.provider,
    }))
}

async function claimPayload(
  ctx: ServiceContext,
  tx: DbOrTx,
  run: RunRow,
  task: TaskRow,
): Promise<ClaimedRunDto> {
  const project = await projectOf(tx, run.projectId)
  const context = await getContextOrThrow(tx, task.id, run.contextRevisionId)
  const [employee] = await tx.select().from(employees).where(eq(employees.id, run.employeeId))
  return {
    run: {
      id: run.id,
      attempt: run.attempt,
      fencingToken: run.fencingToken,
      leaseExpiresAt: run.leaseExpiresAt!.toISOString(),
      sessionRef: run.sessionRef,
      runtime: run.runtime,
    },
    project: { id: project.id, slug: project.slug, name: project.name },
    employee: { id: employee!.id, displayName: employee!.displayName, role: employee!.role },
    task: {
      id: task.id,
      title: task.title,
      scope: task.scope,
      acceptanceCriteria: task.acceptanceCriteria,
    },
    context,
    answers: await answeredQuestions(tx, task.id),
    documents: await Promise.all(
      context.manifest.documents.map(async (d) => ({
        ...d,
        markdown: await revisionMarkdown(ctx, project, d.documentId, d.version),
      })),
    ),
  }
}

/**
 * Takes the lease on a queued run. The row is locked, so of any number of runners claiming at once
 * exactly one succeeds. Repeating the same claim (same key) returns the same lease, which makes a
 * lost response harmless.
 */
export async function claimRun(
  ctx: ServiceContext,
  runner: RunnerRow,
  runId: string,
  input: ClaimRunInput,
): Promise<ClaimedRunDto> {
  return withTx(ctx, async (tx, txCtx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${runner.id}))`)
    const [found] = await tx.select().from(runs).where(eq(runs.id, runId))
    if (!found) throw notFound('Run not found')
    const granted = await grantedProjectIds(tx, runner.id)
    if (!granted.includes(found.projectId) || !runner.providers.includes(found.runtime.provider))
      throw notFound('Run not found')
    const task = await lockTask(tx, found.taskId)
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for('update')
    if (!run) throw notFound('Run not found')

    if (
      run.state === 'running' &&
      run.runnerId === runner.id &&
      run.claimKey === input.idempotencyKey
    )
      return claimPayload({ ...txCtx }, tx, run, task)

    const now = ctx.now()
    if (!isClaimable(run, now))
      throw conflict('This run is not available to claim.', {
        code: 'claim_conflict',
        state: run.state,
      })
    const block = capacityBlock(
      runner.capacity[run.runtime.provider],
      ceilingsFor(runner.ceilings, run.runtime.provider),
      now,
    )
    if (block)
      throw conflict(
        `This account is at ${block.percent}% of its ${block.window === 'fiveHour' ? '5-hour' : 'weekly'} usage, above the ${block.ceiling}% ceiling.`,
        { code: 'capacity_exceeded', ...block },
      )
    const [{ busy } = { busy: 0 }] = await tx
      .select({ busy: sql<number>`count(*)::int` })
      .from(runs)
      .where(and(eq(runs.runnerId, runner.id), eq(runs.state, 'running')))
    if (busy >= runner.maxConcurrent)
      throw conflict('This runner is already running as many tasks as it is set to.', {
        code: 'runner_busy',
      })

    const project = await projectOf(tx, run.projectId)
    const resuming = task.state === 'in_progress'
    if (!resuming && !STARTABLE.has(task.state)) {
      await tx
        .update(runs)
        .set({
          state: 'cancelled',
          fencingToken: run.fencingToken + 1,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(runs.id, runId))
      throw conflict('The task is no longer waiting for work.', { code: 'task_not_startable' })
    }

    const [claimed] = await tx
      .update(runs)
      .set({
        state: 'running',
        runnerId: runner.id,
        claimKey: input.idempotencyKey,
        fencingToken: run.fencingToken + 1,
        leaseExpiresAt: leaseDeadline(now),
        resumeAt: null,
        capacityResumes:
          run.state === 'waiting_for_capacity' ? run.capacityResumes + 1 : run.capacityResumes,
        claimedAt: run.claimedAt ?? now,
        updatedAt: now,
      })
      .where(eq(runs.id, runId))
      .returning()
    if (STARTABLE.has(task.state))
      await moveTaskState(
        tx,
        txCtx,
        project,
        task,
        'in_progress',
        'claim',
        `Run ${run.attempt} started`,
      )
    await notify(tx, txCtx, project.id, 'run.updated', { runId, taskId: task.id, state: 'running' })
    return claimPayload({ ...txCtx }, tx, claimed!, task)
  })
}

/** The run if `runner` still holds it with this fencing token; otherwise a conflict that says stop. */
async function requireLease(
  tx: Tx,
  runner: RunnerRow,
  runId: string,
  fencingToken: number,
): Promise<RunRow> {
  const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).for('update')
  if (!run || run.runnerId !== runner.id) throw notFound('Run not found')
  if (run.fencingToken !== fencingToken || run.state === 'cancelled')
    throw staleFencing(run.fencingToken)
  return run
}

export async function heartbeatRun(
  ctx: ServiceContext,
  runner: RunnerRow,
  runId: string,
  fencingToken: number,
): Promise<{ leaseExpiresAt: string }> {
  return withTx(ctx, async (tx) => {
    const run = await requireLease(tx, runner, runId, fencingToken)
    if (run.state !== 'running') throw staleFencing(run.fencingToken)
    const lease = leaseDeadline(ctx.now())
    await tx
      .update(runs)
      .set({ leaseExpiresAt: lease, updatedAt: ctx.now() })
      .where(eq(runs.id, runId))
    return { leaseExpiresAt: lease.toISOString() }
  })
}

export interface EventReceipt {
  eventId: string
  sequence: number
  duplicate: boolean
}

/**
 * Stores one runner event. The same eventId again is a no-op receipt, so replays after a lost
 * response don't repeat business effects; a new event must come after the last sequence.
 */
export async function recordRunEvent(
  ctx: ServiceContext,
  runner: RunnerRow,
  runId: string,
  input: RunEventInput,
): Promise<EventReceipt> {
  return withTx(ctx, async (tx, txCtx) => {
    const run = await requireLease(tx, runner, runId, input.fencingToken)
    const [dup] = await tx
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.eventId, input.eventId)))
    if (dup) return { eventId: dup.eventId, sequence: dup.sequence, duplicate: true }
    if (run.state !== 'running') throw staleFencing(run.fencingToken)
    if (input.sequence <= run.lastSequence)
      throw conflict(
        `Event ${input.sequence} is out of order; the last accepted was ${run.lastSequence}.`,
        {
          code: 'out_of_order',
          lastSequence: run.lastSequence,
        },
      )
    const now = ctx.now()
    await tx.insert(runEvents).values({
      id: newId(),
      runId,
      eventId: input.eventId,
      sequence: input.sequence,
      type: input.type,
      payload: input.payload,
      recordedAt: now,
    })
    if (input.type === 'capacity_wait') return pauseForCapacity(tx, txCtx, run, input, now)
    const patch: Partial<typeof runs.$inferInsert> = {
      lastSequence: input.sequence,
      leaseExpiresAt: leaseDeadline(now),
      updatedAt: now,
    }
    if (input.type === 'session' && typeof input.payload.sessionRef === 'string')
      patch.sessionRef = input.payload.sessionRef
    await tx.update(runs).set(patch).where(eq(runs.id, runId))
    await notify(tx, txCtx, run.projectId, 'run.updated', {
      runId,
      taskId: run.taskId,
      state: run.state,
    })
    return { eventId: input.eventId, sequence: input.sequence, duplicate: false }
  })
}

const DEFAULT_CAPACITY_WAIT_MS = 30 * 60_000

/**
 * The provider's usage limit was reached. The run waits, without failing, until the reset time and
 * is then claimed again, resuming the same session. The claim is revoked so the stopped process
 * can't report anything more. After a few limit hits in one run a person decides instead.
 */
async function pauseForCapacity(
  tx: Tx,
  ctx: ServiceContext,
  run: RunRow,
  input: RunEventInput,
  now: Date,
): Promise<EventReceipt> {
  const given = typeof input.payload.resetsAt === 'string' ? new Date(input.payload.resetsAt) : null
  const resumeAt =
    given && !Number.isNaN(given.getTime()) && given.getTime() > now.getTime()
      ? given
      : new Date(now.getTime() + DEFAULT_CAPACITY_WAIT_MS)
  const tooMany = run.capacityResumes >= MAX_CAPACITY_RESUMES
  await tx
    .update(runs)
    .set({
      state: tooMany ? 'interrupted' : 'waiting_for_capacity',
      resumeAt: tooMany ? null : resumeAt,
      failureReason: tooMany
        ? 'The usage limit was hit again and again. Decide whether to retry.'
        : null,
      fencingToken: run.fencingToken + 1,
      leaseExpiresAt: null,
      lastSequence: input.sequence,
      finishedAt: tooMany ? now : null,
      updatedAt: now,
    })
    .where(eq(runs.id, run.id))
  await audit(tx, ctx, {
    projectId: run.projectId,
    action: tooMany ? 'run.interrupted' : 'run.waiting_for_capacity',
    targetType: 'run',
    targetId: run.id,
    after: { resumeAt: resumeAt.toISOString(), window: input.payload.window ?? null },
  })
  await notify(tx, ctx, run.projectId, 'run.updated', {
    runId: run.id,
    taskId: run.taskId,
    state: tooMany ? 'interrupted' : 'waiting_for_capacity',
  })
  await notify(tx, ctx, run.projectId, 'task.updated', { taskId: run.taskId })
  return { eventId: input.eventId, sequence: input.sequence, duplicate: false }
}

/**
 * Ends a run. A run that succeeded submits its task for acceptance; it never accepts it. Failed and
 * interrupted runs leave the task in progress with the problem visible. A report from a lease that
 * is no longer current is refused, so a late success can't change anything.
 */
export async function completeRun(
  ctx: ServiceContext,
  runner: RunnerRow,
  runId: string,
  input: CompleteRunInput,
): Promise<RunDto> {
  return withTx(ctx, async (tx, txCtx) => {
    const [existing] = await tx.select().from(runs).where(eq(runs.id, runId))
    if (
      existing &&
      existing.runnerId === runner.id &&
      existing.completionKey === input.idempotencyKey
    ) {
      const wanted = input.outcome
      if (existing.state !== wanted)
        throw conflict('This completion key was already used with a different outcome.', {
          code: 'idempotency_conflict',
        })
      return toRunDto(existing, runner.name)
    }
    // Lock the task before the run, the same order claim and cancel use, so they can't deadlock.
    if (!existing) throw notFound('Run not found')
    const task = await lockTask(tx, existing.taskId)
    const run = await requireLease(tx, runner, runId, input.fencingToken)
    if (run.state !== 'running') throw staleFencing(run.fencingToken)
    const project = await projectOf(tx, run.projectId)
    const now = ctx.now()
    const [row] = await tx
      .update(runs)
      .set({
        state: input.outcome,
        completionKey: input.idempotencyKey,
        summary: input.summary ?? null,
        failureReason:
          input.outcome === 'succeeded'
            ? null
            : (input.failureReason ?? 'The runner reported a problem'),
        leaseExpiresAt: null,
        fencingToken: run.fencingToken + 1,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(runs.id, runId))
      .returning()
    if (input.outcome === 'succeeded' && task.state === 'in_progress')
      await moveTaskState(
        tx,
        txCtx,
        project,
        task,
        'ready_for_acceptance',
        'run_succeeded',
        `Run ${run.attempt} finished and submitted its work`,
      )
    await audit(tx, txCtx, {
      projectId: project.id,
      action: `run.${input.outcome}`,
      targetType: 'run',
      targetId: runId,
      after: { attempt: run.attempt, failureReason: row!.failureReason },
    })
    await notify(tx, txCtx, project.id, 'run.updated', {
      runId,
      taskId: task.id,
      state: input.outcome,
    })
    await notify(tx, txCtx, project.id, 'task.updated', { taskId: task.id, cellId: task.cellId })
    return toRunDto(row!, runner.name)
  })
}

/**
 * Interrupts runs whose lease ran out (runner crashed, lost its network or was revoked). The task
 * stays in progress with the run visibly interrupted; nothing is marked done or retried by itself.
 */
export async function expireLeases(ctx: ServiceContext): Promise<number> {
  const now = ctx.now()
  const stale = await ctx.db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.state, 'running'), lt(runs.leaseExpiresAt, now)))
  let count = 0
  for (const { id } of stale) {
    const done = await withTx(ctx, async (tx, txCtx) => {
      const [run] = await tx.select().from(runs).where(eq(runs.id, id)).for('update')
      if (!run || run.state !== 'running' || !run.leaseExpiresAt || run.leaseExpiresAt >= now)
        return false
      await tx
        .update(runs)
        .set({
          state: 'interrupted',
          failureReason: 'The runner stopped responding before the run finished.',
          fencingToken: run.fencingToken + 1,
          leaseExpiresAt: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(runs.id, id))
      await audit(tx, txCtx, {
        projectId: run.projectId,
        action: 'run.interrupted',
        targetType: 'run',
        targetId: id,
        after: { attempt: run.attempt },
      })
      await notify(tx, txCtx, run.projectId, 'run.updated', {
        runId: id,
        taskId: run.taskId,
        state: 'interrupted',
      })
      await notify(tx, txCtx, run.projectId, 'task.updated', { taskId: run.taskId })
      return true
    })
    if (done) count += 1
  }
  return count
}
