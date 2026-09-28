import type { AcceptInput, LoginInput, SetupInput, UserDto } from '@stagegrid/shared'
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { inviteTokens, sessions, users } from '../db/schema'
import { conflict, notFound, unauthenticated } from '../errors'
import { hashPassword, hashToken, randomToken, verifyPassword } from '../lib/crypto'
import { newId } from '../lib/ids'
import { audit } from './audit'
import { type Actor, type ServiceConfig, type ServiceContext, withTx } from './context'
import { toUserDto } from './dto'
import { needsSetup, setInstanceSettings } from './settings.service'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

export interface SessionMeta {
  userAgent?: string | null
  ip?: string | null
}

export interface AuthResult {
  user: UserDto
  sessionToken: string
}

async function createSession(
  db: DbOrTx,
  config: ServiceConfig,
  userId: string,
  now: Date,
  meta: SessionMeta,
): Promise<string> {
  const token = randomToken()
  await db.insert(sessions).values({
    id: newId(),
    userId,
    tokenHash: hashToken(config.appSecret, token),
    expiresAt: new Date(now.getTime() + config.sessionTtlDays * DAY_MS),
    lastSeenAt: now,
    userAgent: meta.userAgent?.slice(0, 500) ?? null,
    ip: meta.ip ?? null,
    createdAt: now,
  })
  return token
}

/** Creates the first admin. Fails with conflict once any user exists. */
export async function setup(
  ctx: ServiceContext,
  input: SetupInput,
  meta: SessionMeta = {},
): Promise<AuthResult> {
  return withTx(ctx, async (tx, txCtx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stagegrid:setup'))`)
    if (!(await needsSetup(tx))) throw conflict('Stagegrid is already set up')
    const now = ctx.now()
    const [user] = await tx
      .insert(users)
      .values({
        id: newId(),
        email: input.email.trim().toLowerCase(),
        name: input.name,
        passwordHash: await hashPassword(input.password),
        isAdmin: true,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    await setInstanceSettings(
      tx,
      {
        instanceName: input.instanceName,
        timezone: input.timezone,
        setupCompletedAt: now.toISOString(),
      },
      now,
    )
    const actorCtx: ServiceContext = {
      ...txCtx,
      actor: { userId: user!.id, name: user!.name, isAdmin: true, via: ctx.actor?.via ?? 'web' },
    }
    await audit(tx, actorCtx, { action: 'instance.setup', targetType: 'user', targetId: user!.id })
    const sessionToken = await createSession(tx, ctx.config, user!.id, now, meta)
    return { user: toUserDto(user!), sessionToken }
  })
}

export async function login(
  ctx: ServiceContext,
  input: LoginInput,
  meta: SessionMeta = {},
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase()
  const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1)
  const ok = await verifyPassword(user?.passwordHash ?? null, input.password)
  if (!user || !ok || user.status !== 'active')
    throw unauthenticated('Email or password is incorrect')
  const sessionToken = await createSession(ctx.db, ctx.config, user.id, ctx.now(), meta)
  return { user: toUserDto(user), sessionToken }
}

export async function logout(ctx: ServiceContext, sessionToken: string): Promise<void> {
  await ctx.db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(ctx.config.appSecret, sessionToken)))
}

export interface SessionAuth {
  actor: Actor
  sessionId: string
}

/** Validates a session cookie token; slides the expiry at most once an hour. */
export async function authenticateSession(
  db: DbOrTx,
  config: ServiceConfig,
  token: string,
  now: Date,
): Promise<SessionAuth | null> {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(config.appSecret, token)))
    .limit(1)
  if (!row) return null
  if (row.session.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id))
    return null
  }
  if (row.user.status !== 'active') return null
  if (now.getTime() - row.session.lastSeenAt.getTime() > HOUR_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + config.sessionTtlDays * DAY_MS) })
      .where(eq(sessions.id, row.session.id))
  }
  return {
    sessionId: row.session.id,
    actor: { userId: row.user.id, name: row.user.name, isAdmin: row.user.isAdmin, via: 'web' },
  }
}

async function findUsableInvite(db: DbOrTx, config: ServiceConfig, token: string, now: Date) {
  const [row] = await db
    .select({ invite: inviteTokens, user: users })
    .from(inviteTokens)
    .innerJoin(users, eq(users.id, inviteTokens.userId))
    .where(
      and(
        eq(inviteTokens.tokenHash, hashToken(config.appSecret, token)),
        isNull(inviteTokens.usedAt),
        gt(inviteTokens.expiresAt, now),
      ),
    )
    .limit(1)
  if (!row || row.user.status === 'disabled') return null
  return row
}

export async function tokenInfo(
  ctx: ServiceContext,
  token: string,
): Promise<{ kind: 'invite' | 'reset'; email: string; name: string }> {
  const row = await findUsableInvite(ctx.db, ctx.config, token, ctx.now())
  if (!row) throw notFound('This link is invalid or has expired')
  return { kind: row.invite.kind, email: row.user.email, name: row.user.name }
}

/** Consumes an invite or reset link: sets the password, activates the user, and signs them in. */
export async function acceptToken(
  ctx: ServiceContext,
  input: AcceptInput,
  meta: SessionMeta = {},
): Promise<AuthResult> {
  return withTx(ctx, async (tx, txCtx) => {
    const now = ctx.now()
    const row = await findUsableInvite(tx, ctx.config, input.token, now)
    if (!row) throw notFound('This link is invalid or has expired')
    const [user] = await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(input.password),
        status: 'active',
        name: row.invite.kind === 'invite' && input.name ? input.name : row.user.name,
        updatedAt: now,
      })
      .where(eq(users.id, row.user.id))
      .returning()
    await tx.update(inviteTokens).set({ usedAt: now }).where(eq(inviteTokens.id, row.invite.id))
    await tx.delete(sessions).where(eq(sessions.userId, row.user.id))
    const actorCtx: ServiceContext = {
      ...txCtx,
      actor: { userId: user!.id, name: user!.name, isAdmin: user!.isAdmin, via: 'web' },
    }
    await audit(tx, actorCtx, {
      action: row.invite.kind === 'invite' ? 'user.accept_invite' : 'user.reset_password',
      targetType: 'user',
      targetId: user!.id,
    })
    const sessionToken = await createSession(tx, ctx.config, user!.id, now, meta)
    return { user: toUserDto(user!), sessionToken }
  })
}

/** Changes the actor's password and signs out their other sessions. */
export async function changePassword(
  ctx: ServiceContext,
  currentSessionId: string | null,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const actorId = ctx.actor?.userId
  if (!actorId) throw unauthenticated()
  await withTx(ctx, async (tx, txCtx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, actorId))
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw unauthenticated('Current password is incorrect')
    }
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword), updatedAt: ctx.now() })
      .where(eq(users.id, actorId))
    await tx
      .delete(sessions)
      .where(
        currentSessionId
          ? and(eq(sessions.userId, actorId), ne(sessions.id, currentSessionId))
          : eq(sessions.userId, actorId),
      )
    await audit(tx, txCtx, {
      action: 'user.change_password',
      targetType: 'user',
      targetId: actorId,
    })
  })
}
