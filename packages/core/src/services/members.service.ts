import type { ProjectRole } from '@stagegrid/shared'
import { and, asc, eq, ne, sql } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { projectMembers, users } from '../db/schema'
import { conflict, notFound } from '../errors'
import { notify } from '../realtime/notify'
import { requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'

export interface MemberDto {
  userId: string
  name: string
  email: string
  role: ProjectRole
  status: 'invited' | 'active' | 'disabled'
}

async function otherOwnerCount(
  db: DbOrTx,
  projectId: string,
  exceptUserId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.role, 'owner'),
        ne(projectMembers.userId, exceptUserId),
      ),
    )
  return row?.n ?? 0
}

export async function listMembers(ctx: ServiceContext, ref: string): Promise<MemberDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  return ctx.db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: projectMembers.role,
      status: users.status,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, project.id))
    .orderBy(asc(users.name))
}

export async function addMember(
  ctx: ServiceContext,
  ref: string,
  input: { userId: string; role: ProjectRole },
): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  await withTx(ctx, async (tx, txCtx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId))
    if (!user || user.status === 'disabled') throw notFound('User not found')
    const [existing] = await tx
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, input.userId)))
    if (existing) throw conflict('This user is already a member')
    await tx.insert(projectMembers).values({
      projectId: project.id,
      userId: input.userId,
      role: input.role,
      createdAt: ctx.now(),
    })
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'member.add',
      targetType: 'user',
      targetId: input.userId,
      after: { role: input.role },
    })
    await notify(tx, txCtx, project.id, 'project.updated')
  })
}

export async function updateMember(
  ctx: ServiceContext,
  ref: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  await withTx(ctx, async (tx, txCtx) => {
    const [m] = await tx
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, userId)))
    if (!m) throw notFound('Member not found')
    if (
      m.role === 'owner' &&
      role !== 'owner' &&
      (await otherOwnerCount(tx, project.id, userId)) === 0
    ) {
      throw conflict('A project needs at least one owner')
    }
    await tx
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, userId)))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'member.update',
      targetType: 'user',
      targetId: userId,
      before: { role: m.role },
      after: { role },
    })
    await notify(tx, txCtx, project.id, 'project.updated')
  })
}

export async function removeMember(
  ctx: ServiceContext,
  ref: string,
  userId: string,
): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  await withTx(ctx, async (tx, txCtx) => {
    const [m] = await tx
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, userId)))
    if (!m) throw notFound('Member not found')
    if (m.role === 'owner' && (await otherOwnerCount(tx, project.id, userId)) === 0) {
      throw conflict('A project needs at least one owner')
    }
    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, userId)))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'member.remove',
      targetType: 'user',
      targetId: userId,
      before: { role: m.role },
    })
    await notify(tx, txCtx, project.id, 'member.removed', { userId })
  })
}
