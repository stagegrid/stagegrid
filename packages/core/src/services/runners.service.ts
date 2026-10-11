import {
  type CreateEnrollmentInput,
  type EnrollRunnerInput,
  type ReportCapacityInput,
  RUNNER_ENROLLMENT_MINUTES,
  RUNNER_ONLINE_SECONDS,
  type RunnerDto,
  type RunnerEnrollmentDto,
  type RunnerSelfInput,
  type UpdateRunnerInput,
} from '@stagegrid/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { projects, runnerEnrollments, runnerProjects, runners } from '../db/schema'
import { conflict, invalid, notFound, unauthenticated } from '../errors'
import { hashToken, randomToken } from '../lib/crypto'
import { newId } from '../lib/ids'
import { requireAdmin } from './access'
import { audit } from './audit'
import { type ServiceConfig, type ServiceContext, withTx } from './context'

export const ENROLLMENT_PREFIX = 'sg_enroll_'
export const RUNNER_PREFIX = 'sg_runner_'
const PREFIX_LENGTH = 14
const LAST_SEEN_RESOLUTION_MS = 5_000

export type RunnerRow = typeof runners.$inferSelect

export function isOnline(r: Pick<RunnerRow, 'lastSeenAt' | 'revokedAt'>, now: Date): boolean {
  return (
    !r.revokedAt &&
    r.lastSeenAt !== null &&
    now.getTime() - r.lastSeenAt.getTime() < RUNNER_ONLINE_SECONDS * 1000
  )
}

async function toDtos(db: DbOrTx, rows: RunnerRow[], now: Date): Promise<RunnerDto[]> {
  const grants = rows.length
    ? await db
        .select()
        .from(runnerProjects)
        .where(
          inArray(
            runnerProjects.runnerId,
            rows.map((r) => r.id),
          ),
        )
    : []
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    providers: r.providers,
    version: r.version,
    maxConcurrent: r.maxConcurrent,
    ceilings: r.ceilings,
    capacity: r.capacity,
    online: isOnline(r, now),
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    projectIds: grants.filter((g) => g.runnerId === r.id).map((g) => g.projectId),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}

async function assertProjectsExist(db: DbOrTx, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)]
  const found = await db
    .select({ id: projects.id })
    .from(projects)
    .where(inArray(projects.id, unique))
  if (found.length !== unique.length) throw invalid('One of the projects does not exist')
}

/** An admin issues a one-time token; the runner exchanges it for its own credential. */
export async function createEnrollment(
  ctx: ServiceContext,
  input: CreateEnrollmentInput,
): Promise<RunnerEnrollmentDto> {
  const admin = requireAdmin(ctx)
  return withTx(ctx, async (tx, txCtx) => {
    await assertProjectsExist(tx, input.projectIds)
    const token = randomToken(ENROLLMENT_PREFIX)
    const now = ctx.now()
    const expiresAt = new Date(now.getTime() + RUNNER_ENROLLMENT_MINUTES * 60_000)
    const projectIds = [...new Set(input.projectIds)]
    const [row] = await tx
      .insert(runnerEnrollments)
      .values({
        id: newId(),
        tokenHash: hashToken(ctx.config.appSecret, token),
        name: input.name,
        projectIds,
        createdBy: admin.userId,
        createdAt: now,
        expiresAt,
      })
      .returning()
    await audit(tx, txCtx, {
      action: 'runner.enrollment',
      targetType: 'runner_enrollment',
      targetId: row!.id,
      after: { name: input.name, projectIds },
    })
    return { id: row!.id, name: row!.name, token, projectIds, expiresAt: expiresAt.toISOString() }
  })
}

/** Exchanges an enrollment token for a runner credential. The token works once. */
export async function enrollRunner(
  ctx: ServiceContext,
  input: EnrollRunnerInput,
): Promise<{ credential: string; runner: RunnerDto }> {
  if (!input.token.startsWith(ENROLLMENT_PREFIX))
    throw unauthenticated('Enrollment token is not valid')
  return withTx(ctx, async (tx, txCtx) => {
    const now = ctx.now()
    // Claiming the token is one conditional update, so two runners can't both use it.
    const [enrollment] = await tx
      .update(runnerEnrollments)
      .set({ usedAt: now })
      .where(
        and(
          eq(runnerEnrollments.tokenHash, hashToken(ctx.config.appSecret, input.token)),
          isNull(runnerEnrollments.usedAt),
        ),
      )
      .returning()
    if (!enrollment || enrollment.expiresAt.getTime() <= now.getTime())
      throw unauthenticated('Enrollment token is not valid, was already used, or has expired')

    const credential = randomToken(RUNNER_PREFIX)
    const [runner] = await tx
      .insert(runners)
      .values({
        id: newId(),
        name: enrollment.name,
        credentialHash: hashToken(ctx.config.appSecret, credential),
        credentialPrefix: credential.slice(0, PREFIX_LENGTH),
        providers: input.providers,
        version: input.version ?? null,
        lastSeenAt: now,
        createdBy: enrollment.createdBy,
        createdAt: now,
      })
      .returning()
    await tx
      .insert(runnerProjects)
      .values(enrollment.projectIds.map((projectId) => ({ runnerId: runner!.id, projectId })))
    await tx
      .update(runnerEnrollments)
      .set({ runnerId: runner!.id })
      .where(eq(runnerEnrollments.id, enrollment.id))
    await audit(tx, txCtx, {
      action: 'runner.enroll',
      targetType: 'runner',
      targetId: runner!.id,
      after: { name: runner!.name, providers: input.providers },
    })
    const [dto] = await toDtos(tx, [runner!], now)
    return { credential, runner: dto! }
  })
}

/** Resolves a runner credential; null when unknown or revoked. Keeps lastSeenAt fresh. */
export async function authenticateRunner(
  db: DbOrTx,
  config: ServiceConfig,
  credential: string,
  now: Date,
): Promise<RunnerRow | null> {
  if (!credential.startsWith(RUNNER_PREFIX)) return null
  const [row] = await db
    .select()
    .from(runners)
    .where(eq(runners.credentialHash, hashToken(config.appSecret, credential)))
  if (!row || row.revokedAt) return null
  if (!row.lastSeenAt || now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    await db.update(runners).set({ lastSeenAt: now }).where(eq(runners.id, row.id))
    return { ...row, lastSeenAt: now }
  }
  return row
}

export async function updateRunnerSelf(
  ctx: ServiceContext,
  runner: RunnerRow,
  input: RunnerSelfInput,
): Promise<void> {
  await ctx.db
    .update(runners)
    .set({ providers: input.providers, version: input.version ?? runner.version })
    .where(eq(runners.id, runner.id))
}

/** Stores the usage the runner read from the provider's own telemetry (Claude events, Codex session files). */
export async function reportCapacity(
  ctx: ServiceContext,
  runner: RunnerRow,
  input: ReportCapacityInput,
): Promise<void> {
  await withTx(ctx, async (tx) => {
    const [current] = await tx.select().from(runners).where(eq(runners.id, runner.id)).for('update')
    await tx
      .update(runners)
      .set({
        capacity: {
          ...current!.capacity,
          [input.provider]: {
            fiveHour: input.fiveHour,
            weekly: input.weekly,
            reportedAt: ctx.now().toISOString(),
          },
        },
      })
      .where(eq(runners.id, runner.id))
  })
}

export async function listRunners(ctx: ServiceContext): Promise<RunnerDto[]> {
  requireAdmin(ctx)
  const rows = await ctx.db.select().from(runners).orderBy(asc(runners.createdAt), asc(runners.id))
  return toDtos(ctx.db, rows, ctx.now())
}

export async function updateRunner(
  ctx: ServiceContext,
  id: string,
  input: UpdateRunnerInput,
): Promise<RunnerDto> {
  requireAdmin(ctx)
  return withTx(ctx, async (tx, txCtx) => {
    const [current] = await tx.select().from(runners).where(eq(runners.id, id))
    if (!current) throw notFound('Runner not found')
    if (current.revokedAt) throw conflict('This runner was revoked.')
    if (input.projectIds) {
      await assertProjectsExist(tx, input.projectIds)
      await tx.delete(runnerProjects).where(eq(runnerProjects.runnerId, id))
      await tx
        .insert(runnerProjects)
        .values([...new Set(input.projectIds)].map((projectId) => ({ runnerId: id, projectId })))
    }
    const [row] = await tx
      .update(runners)
      .set({
        name: input.name,
        maxConcurrent: input.maxConcurrent,
        ceilings: input.ceilings ? { ...current.ceilings, ...input.ceilings } : undefined,
      })
      .where(eq(runners.id, id))
      .returning()
    await audit(tx, txCtx, {
      action: 'runner.update',
      targetType: 'runner',
      targetId: id,
      after: input,
    })
    const [dto] = await toDtos(tx, [row!], ctx.now())
    return dto!
  })
}

/** Revoking stops the credential working at once; runs it holds are interrupted by lease expiry. */
export async function revokeRunner(ctx: ServiceContext, id: string): Promise<void> {
  requireAdmin(ctx)
  await withTx(ctx, async (tx, txCtx) => {
    const [row] = await tx
      .update(runners)
      .set({ revokedAt: ctx.now() })
      .where(and(eq(runners.id, id), isNull(runners.revokedAt)))
      .returning()
    if (!row) throw notFound('Runner not found')
    await audit(tx, txCtx, { action: 'runner.revoke', targetType: 'runner', targetId: id })
  })
}

/** Is there an online runner that could take work for this project and provider? */
export async function eligibleRunnerExists(
  db: DbOrTx,
  projectId: string,
  provider: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .select({ r: runners })
    .from(runners)
    .innerJoin(runnerProjects, eq(runnerProjects.runnerId, runners.id))
    .where(and(eq(runnerProjects.projectId, projectId), isNull(runners.revokedAt)))
  return rows.some(({ r }) => isOnline(r, now) && r.providers.includes(provider))
}
