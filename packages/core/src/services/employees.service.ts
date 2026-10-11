import type { CreateEmployeeInput, EmployeeDto, UpdateEmployeeInput } from '@stagegrid/shared'
import { LIMITS } from '@stagegrid/shared'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { employees } from '../db/schema'
import { conflict, invalid, notFound } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'

export type EmployeeRow = typeof employees.$inferSelect

export function toEmployeeDto(e: EmployeeRow): EmployeeDto {
  return {
    id: e.id,
    displayName: e.displayName,
    role: e.role,
    instructions: e.instructions,
    provider: e.provider,
    model: e.model,
    avatar: e.avatar,
    version: e.version,
    archivedAt: e.archivedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  }
}

const UNIQUE_NAME = 'employees_name_uq'

function isDuplicateName(e: unknown): boolean {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown }
  if (err?.code === '23505' && err.constraint_name === UNIQUE_NAME) return true
  return err?.cause ? isDuplicateName(err.cause) : false
}

const duplicateName = (name: string) =>
  conflict(`Someone on this project is already called "${name}". Pick another name.`)

export async function loadEmployeeInProject(
  db: DbOrTx,
  project: ProjectRow,
  id: string,
): Promise<EmployeeRow> {
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.projectId, project.id)))
  if (!row) throw notFound('Employee not found')
  return row
}

export async function listEmployees(
  ctx: ServiceContext,
  ref: string,
  opts: { includeArchived?: boolean } = {},
): Promise<EmployeeDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const rows = await ctx.db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.projectId, project.id),
        opts.includeArchived ? undefined : isNull(employees.archivedAt),
      ),
    )
    .orderBy(asc(employees.createdAt), asc(employees.id))
  return rows.map(toEmployeeDto)
}

export async function getEmployee(
  ctx: ServiceContext,
  ref: string,
  id: string,
): Promise<EmployeeDto> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  return toEmployeeDto(await loadEmployeeInProject(ctx.db, project, id))
}

export async function createEmployee(
  ctx: ServiceContext,
  ref: string,
  input: CreateEmployeeInput,
): Promise<EmployeeDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  try {
    return await withTx(ctx, async (tx, txCtx) => {
      const [counted] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(and(eq(employees.projectId, project.id), isNull(employees.archivedAt)))
      if ((counted?.n ?? 0) >= LIMITS.employeesPerProject)
        throw invalid(`A project can have at most ${LIMITS.employeesPerProject} employees`)
      const now = ctx.now()
      const [row] = await tx
        .insert(employees)
        .values({
          id: newId(),
          projectId: project.id,
          displayName: input.displayName,
          role: input.role,
          instructions: input.instructions,
          provider: input.provider,
          model: input.model,
          avatar: input.avatar,
          createdBy: ctx.actor!.userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      await audit(tx, txCtx, {
        projectId: project.id,
        action: 'employee.create',
        targetType: 'employee',
        targetId: row!.id,
        after: { displayName: row!.displayName, role: row!.role, provider: row!.provider },
      })
      await notify(tx, txCtx, project.id, 'employee.updated', { employeeId: row!.id })
      return toEmployeeDto(row!)
    })
  } catch (e) {
    if (isDuplicateName(e)) throw duplicateName(input.displayName)
    throw e
  }
}

export async function updateEmployee(
  ctx: ServiceContext,
  ref: string,
  id: string,
  input: UpdateEmployeeInput,
): Promise<EmployeeDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  try {
    return await withTx(ctx, async (tx, txCtx) => {
      const current = await loadEmployeeInProject(tx, project, id)
      if (current.archivedAt) throw conflict('This employee is archived. Restore them to edit.')
      const { expectedVersion, ...patch } = input
      const changed = Object.entries(patch).filter(([, v]) => v !== undefined)
      if (changed.length === 0) throw invalid('Nothing to change')
      const [row] = await tx
        .update(employees)
        .set({ ...patch, version: current.version + 1, updatedAt: ctx.now() })
        .where(and(eq(employees.id, id), eq(employees.version, expectedVersion)))
        .returning()
      if (!row)
        throw conflict('This employee changed since you loaded them. Reload and try again.', {
          code: 'stale_version',
          currentVersion: current.version,
        })
      await audit(tx, txCtx, {
        projectId: project.id,
        action: 'employee.update',
        targetType: 'employee',
        targetId: id,
        before: Object.fromEntries(changed.map(([k]) => [k, current[k as keyof EmployeeRow]])),
        after: Object.fromEntries(changed),
      })
      await notify(tx, txCtx, project.id, 'employee.updated', { employeeId: id })
      return toEmployeeDto(row)
    })
  } catch (e) {
    if (isDuplicateName(e)) throw duplicateName(input.displayName ?? '')
    throw e
  }
}

/** Archiving stops new work; tasks, runs and history that name the employee stay intact. */
export async function setEmployeeArchived(
  ctx: ServiceContext,
  ref: string,
  id: string,
  archived: boolean,
): Promise<EmployeeDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  try {
    return await withTx(ctx, async (tx, txCtx) => {
      const current = await loadEmployeeInProject(tx, project, id)
      if (Boolean(current.archivedAt) === archived) return toEmployeeDto(current)
      const now = ctx.now()
      const [row] = await tx
        .update(employees)
        .set({ archivedAt: archived ? now : null, version: current.version + 1, updatedAt: now })
        .where(eq(employees.id, id))
        .returning()
      await audit(tx, txCtx, {
        projectId: project.id,
        action: archived ? 'employee.archive' : 'employee.restore',
        targetType: 'employee',
        targetId: id,
        after: { displayName: current.displayName },
      })
      await notify(tx, txCtx, project.id, 'employee.updated', { employeeId: id })
      return toEmployeeDto(row!)
    })
  } catch (e) {
    if (isDuplicateName(e)) throw duplicateName('this name')
    throw e
  }
}

/** An active employee of the project, or a validation error: used when assigning work. */
export async function requireActiveEmployee(
  db: DbOrTx,
  project: ProjectRow,
  id: string,
): Promise<EmployeeRow> {
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.projectId, project.id)))
  if (!row) throw invalid(`Employee ${id} is not part of this project`)
  if (row.archivedAt) throw invalid(`${row.displayName} is archived and can't take new work`)
  return row
}
