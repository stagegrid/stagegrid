import type { CreateTokenInput, TokenDto, Via } from '@stagegrid/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { apiTokens, users } from '../db/schema'
import { notFound } from '../errors'
import { hashToken, randomToken } from '../lib/crypto'
import { newId } from '../lib/ids'
import { audit } from './audit'
import {
  type Actor,
  requireActor,
  type ServiceConfig,
  type ServiceContext,
  withTx,
} from './context'

export const TOKEN_PREFIX = 'sg_pat_'
const PREFIX_LENGTH = 12
const DAY_MS = 86_400_000
const LAST_USED_RESOLUTION_MS = 60_000

type TokenRow = typeof apiTokens.$inferSelect

function toDto(t: TokenRow): TokenDto {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    expiresAt: t.expiresAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  }
}

export async function listTokens(ctx: ServiceContext): Promise<TokenDto[]> {
  const actor = requireActor(ctx)
  const rows = await ctx.db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, actor.userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt))
  return rows.map(toDto)
}

/** Creates a personal access token. The plain token is returned once and never stored. */
export async function createToken(
  ctx: ServiceContext,
  input: CreateTokenInput,
): Promise<{ token: string; meta: TokenDto }> {
  const actor = requireActor(ctx)
  return withTx(ctx, async (tx, txCtx) => {
    const token = randomToken(TOKEN_PREFIX)
    const now = ctx.now()
    const [row] = await tx
      .insert(apiTokens)
      .values({
        id: newId(),
        userId: actor.userId,
        name: input.name,
        tokenHash: hashToken(ctx.config.appSecret, token),
        prefix: token.slice(0, PREFIX_LENGTH),
        expiresAt: input.expiresInDays
          ? new Date(now.getTime() + input.expiresInDays * DAY_MS)
          : null,
        createdAt: now,
      })
      .returning()
    await audit(tx, txCtx, {
      action: 'token.create',
      targetType: 'api_token',
      targetId: row!.id,
      after: { name: input.name },
    })
    return { token, meta: toDto(row!) }
  })
}

export async function revokeToken(ctx: ServiceContext, tokenId: string): Promise<void> {
  const actor = requireActor(ctx)
  await withTx(ctx, async (tx, txCtx) => {
    const [row] = await tx
      .update(apiTokens)
      .set({ revokedAt: ctx.now() })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.userId, actor.userId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning()
    if (!row) throw notFound('Token not found')
    await audit(tx, txCtx, { action: 'token.revoke', targetType: 'api_token', targetId: tokenId })
  })
}

/** Resolves a bearer token to an actor; null when unknown, revoked, expired, or the user isn't active. */
export async function authenticateToken(
  db: DbOrTx,
  config: ServiceConfig,
  token: string,
  now: Date,
  via: Via,
): Promise<Actor | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const [row] = await db
    .select({ token: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hashToken(config.appSecret, token)))
    .limit(1)
  if (!row || row.token.revokedAt || row.user.status !== 'active') return null
  if (row.token.expiresAt && row.token.expiresAt.getTime() <= now.getTime()) return null
  if (
    !row.token.lastUsedAt ||
    now.getTime() - row.token.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS
  ) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.token.id))
  }
  return { userId: row.user.id, name: row.user.name, isAdmin: row.user.isAdmin, via }
}
