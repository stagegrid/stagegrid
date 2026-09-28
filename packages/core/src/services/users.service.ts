import type { CreateUserInput, UpdateUserInput, UserDto } from '@stagegrid/shared'
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { inviteTokens, sessions, users } from '../db/schema'
import { conflict, invalid, notFound } from '../errors'
import { hashToken, randomToken } from '../lib/crypto'
import { newId } from '../lib/ids'
import { requireAdmin } from './access'
import { audit } from './audit'
import { requireActor, type ServiceConfig, type ServiceContext, withTx } from './context'
import { toUserDto, type UserRow } from './dto'

const DAY_MS = 86_400_000
const INVITE_TTL_MS = 7 * DAY_MS
const RESET_TTL_MS = DAY_MS

export interface LinkResult {
  link: string
  expiresAt: string
}

async function issueLink(
  db: DbOrTx,
  config: ServiceConfig,
  userId: string,
  kind: 'invite' | 'reset',
  now: Date,
  createdBy: string | null,
): Promise<LinkResult> {
  // A new link makes older unused links of the same kind unusable.
  await db
    .update(inviteTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(inviteTokens.userId, userId),
        eq(inviteTokens.kind, kind),
        isNull(inviteTokens.usedAt),
      ),
    )
  const token = randomToken()
  const expiresAt = new Date(now.getTime() + (kind === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS))
  await db.insert(inviteTokens).values({
    id: newId(),
    userId,
    kind,
    tokenHash: hashToken(config.appSecret, token),
    expiresAt,
    createdBy,
    createdAt: now,
  })
  return {
    link: `${config.appUrl}/accept?token=${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString(),
  }
}

async function getUserOr404(db: DbOrTx, id: string): Promise<UserRow> {
  const [u] = await db.select().from(users).where(eq(users.id, id))
  if (!u) throw notFound('User not found')
  return u
}

async function activeAdminCount(db: DbOrTx, exceptUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.isAdmin, true), eq(users.status, 'active'), ne(users.id, exceptUserId)))
  return row?.n ?? 0
}

export async function listUsers(ctx: ServiceContext): Promise<UserDto[]> {
  requireAdmin(ctx)
  const rows = await ctx.db.select().from(users).orderBy(asc(users.name))
  return rows.map(toUserDto)
}

/** Active users anyone signed in can pick from (for adding project members). */
export async function listDirectory(
  ctx: ServiceContext,
): Promise<{ id: string; name: string; email: string }[]> {
  requireActor(ctx)
  return ctx.db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.status, 'active'))
    .orderBy(asc(users.name))
}

export async function inviteUser(
  ctx: ServiceContext,
  input: CreateUserInput,
): Promise<{ user: UserDto } & LinkResult> {
  const actor = requireAdmin(ctx)
  const email = input.email.trim().toLowerCase()
  return withTx(ctx, async (tx, txCtx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email))
    if (existing) throw conflict('A user with this email already exists')
    const now = ctx.now()
    const [user] = await tx
      .insert(users)
      .values({
        id: newId(),
        email,
        name: input.name,
        isAdmin: input.isAdmin,
        status: 'invited',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    const link = await issueLink(tx, ctx.config, user!.id, 'invite', now, actor.userId)
    await audit(tx, txCtx, {
      action: 'user.invite',
      targetType: 'user',
      targetId: user!.id,
      after: { email, isAdmin: input.isAdmin },
    })
    return { user: toUserDto(user!), ...link }
  })
}

export async function createInviteLink(ctx: ServiceContext, userId: string): Promise<LinkResult> {
  const actor = requireAdmin(ctx)
  return withTx(ctx, async (tx, txCtx) => {
    const user = await getUserOr404(tx, userId)
    if (user.status !== 'invited') throw conflict('This user has already accepted their invite')
    const link = await issueLink(tx, ctx.config, userId, 'invite', ctx.now(), actor.userId)
    await audit(tx, txCtx, { action: 'user.invite_link', targetType: 'user', targetId: userId })
    return link
  })
}

export async function createResetLink(ctx: ServiceContext, userId: string): Promise<LinkResult> {
  const actor = requireAdmin(ctx)
  return withTx(ctx, async (tx, txCtx) => {
    const user = await getUserOr404(tx, userId)
    if (user.status !== 'active') throw conflict('Only active users can reset their password')
    const link = await issueLink(tx, ctx.config, userId, 'reset', ctx.now(), actor.userId)
    await audit(tx, txCtx, { action: 'user.reset_link', targetType: 'user', targetId: userId })
    return link
  })
}

/** Used by `stagegrid admin:reset-link` — no signed-in actor, run by whoever has shell access. */
export async function createResetLinkForEmail(
  ctx: ServiceContext,
  email: string,
): Promise<LinkResult> {
  return withTx(ctx, async (tx, txCtx) => {
    const [user] = await tx.select().from(users).where(eq(users.email, email.trim().toLowerCase()))
    if (!user) throw notFound(`No user with email ${email}`)
    if (user.status !== 'active') throw conflict('Only active users can reset their password')
    const link = await issueLink(tx, ctx.config, user.id, 'reset', ctx.now(), null)
    await audit(tx, txCtx, { action: 'user.reset_link', targetType: 'user', targetId: user.id })
    return link
  })
}

export async function updateUser(
  ctx: ServiceContext,
  userId: string,
  input: UpdateUserInput,
): Promise<UserDto> {
  const actor = requireAdmin(ctx)
  return withTx(ctx, async (tx, txCtx) => {
    const user = await getUserOr404(tx, userId)
    if (input.status === 'active' && user.status === 'invited') {
      throw invalid('Invited users become active when they accept their invite')
    }
    const losesAdmin =
      user.isAdmin &&
      user.status === 'active' &&
      (input.isAdmin === false || input.status === 'disabled')
    if (losesAdmin && (await activeAdminCount(tx, userId)) === 0) {
      throw conflict("You can't remove the last active admin")
    }
    if (userId === actor.userId && input.status === 'disabled')
      throw conflict("You can't disable yourself")
    const [updated] = await tx
      .update(users)
      .set({
        name: input.name ?? user.name,
        isAdmin: input.isAdmin ?? user.isAdmin,
        status: input.status ?? user.status,
        updatedAt: ctx.now(),
      })
      .where(eq(users.id, userId))
      .returning()
    if (input.status === 'disabled') await tx.delete(sessions).where(eq(sessions.userId, userId))
    await audit(tx, txCtx, {
      action: input.status === 'disabled' ? 'user.disable' : 'user.update',
      targetType: 'user',
      targetId: userId,
      before: { name: user.name, isAdmin: user.isAdmin, status: user.status },
      after: { name: updated!.name, isAdmin: updated!.isAdmin, status: updated!.status },
    })
    return toUserDto(updated!)
  })
}

export async function getMe(ctx: ServiceContext): Promise<UserDto> {
  const actor = requireActor(ctx)
  return toUserDto(await getUserOr404(ctx.db, actor.userId))
}

export async function updateMe(ctx: ServiceContext, input: { name: string }): Promise<UserDto> {
  const actor = requireActor(ctx)
  const [u] = await ctx.db
    .update(users)
    .set({ name: input.name, updatedAt: ctx.now() })
    .where(eq(users.id, actor.userId))
    .returning()
  return toUserDto(u!)
}
