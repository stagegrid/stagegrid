import { createHash } from 'node:crypto'

import type { Via } from '@stagegrid/shared'
import { and, desc, eq, isNull } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { oauthClients, oauthCodes, oauthTokens, users } from '../db/schema'
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

export const ACCESS_PREFIX = 'sg_oat_'
export const REFRESH_PREFIX = 'sg_ort_'
export const SCOPE = 'stagegrid'
const CODE_TTL_MS = 60_000
const ACCESS_TTL_S = 3600
const REFRESH_TTL_MS = 30 * 86_400_000

/** RFC 6749 §5.2-style error; `redirectable` errors go back to the client, others are shown to the user. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description)
    this.name = 'OAuthError'
  }
}

export const mcpResource = (config: Pick<ServiceConfig, 'appUrl'>) => `${config.appUrl}/mcp`

function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.hash) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

export async function registerClient(
  db: DbOrTx,
  input: { client_name?: unknown; redirect_uris?: unknown },
  now: Date,
) {
  const uris = Array.isArray(input.redirect_uris)
    ? input.redirect_uris.filter((x): x is string => typeof x === 'string')
    : []
  if (uris.length === 0 || uris.length > 10 || !uris.every(validRedirectUri)) {
    throw new OAuthError(
      'invalid_redirect_uri',
      'redirect_uris must be https URLs or http://localhost URLs',
    )
  }
  const clientName =
    typeof input.client_name === 'string' && input.client_name.trim()
      ? input.client_name.trim().slice(0, 100)
      : 'MCP client'
  const clientId = `sg_client_${randomToken().slice(0, 24)}`
  await db
    .insert(oauthClients)
    .values({ id: newId(), clientId, clientName, redirectUris: uris, createdAt: now })
  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: uris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(now.getTime() / 1000),
  }
}

export interface AuthorizeParams {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string | null
  scope: string
  resource: string | null
}

/**
 * Validates /oauth/authorize parameters. Unknown clients and unregistered redirect URIs throw with
 * `redirectable = false` (never redirect to an unverified URI); other problems are sent back to it.
 */
export async function validateAuthorize(
  db: DbOrTx,
  config: ServiceConfig,
  q: Record<string, string | undefined>,
): Promise<{ params: AuthorizeParams; clientName: string }> {
  const [client] = q.client_id
    ? await db.select().from(oauthClients).where(eq(oauthClients.clientId, q.client_id))
    : []
  if (!client)
    throw Object.assign(new OAuthError('invalid_client', 'Unknown client_id'), {
      redirectable: false,
    })
  const redirectUri =
    q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : '')
  if (!client.redirectUris.includes(redirectUri)) {
    throw Object.assign(
      new OAuthError('invalid_request', 'redirect_uri is not registered for this client'),
      { redirectable: false },
    )
  }
  const fail = (error: string, description: string) =>
    Object.assign(new OAuthError(error, description), {
      redirectable: true,
      redirectUri,
      state: q.state ?? null,
    })
  if (q.response_type !== 'code')
    throw fail('unsupported_response_type', 'Only response_type=code is supported')
  if (!q.code_challenge || q.code_challenge_method !== 'S256')
    throw fail('invalid_request', 'PKCE with code_challenge_method=S256 is required')
  const scope = q.scope?.trim() || SCOPE
  if (scope.split(/\s+/).some((s) => s !== SCOPE))
    throw fail('invalid_scope', `The only scope is "${SCOPE}"`)
  const resource = q.resource ? q.resource.replace(/\/+$/, '') : null
  if (resource && resource !== mcpResource(config) && resource !== config.appUrl) {
    throw fail('invalid_target', `resource must be ${mcpResource(config)}`)
  }
  return {
    params: {
      clientId: client.clientId,
      redirectUri,
      codeChallenge: q.code_challenge,
      state: q.state ?? null,
      scope,
      resource,
    },
    clientName: client.clientName,
  }
}

function withQuery(uri: string, params: Record<string, string | null>): string {
  const u = new URL(uri)
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v)
  return u.toString()
}

/** The signed-in user approves (or denies) the client; returns where to send the browser. */
export async function consent(
  ctx: ServiceContext,
  params: AuthorizeParams,
  approve: boolean,
): Promise<{ redirect: string }> {
  const actor = requireActor(ctx)
  if (!approve)
    return {
      redirect: withQuery(params.redirectUri, { error: 'access_denied', state: params.state }),
    }
  const code = randomToken()
  await withTx(ctx, async (tx, txCtx) => {
    await tx.insert(oauthCodes).values({
      id: newId(),
      codeHash: hashToken(ctx.config.appSecret, code),
      clientId: params.clientId,
      userId: actor.userId,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: params.scope,
      resource: params.resource,
      expiresAt: new Date(ctx.now().getTime() + CODE_TTL_MS),
      createdAt: ctx.now(),
    })
    await audit(tx, txCtx, {
      action: 'oauth.consent',
      targetType: 'oauth_client',
      after: { clientId: params.clientId },
    })
  })
  return { redirect: withQuery(params.redirectUri, { code, state: params.state }) }
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

async function issue(
  db: DbOrTx,
  config: ServiceConfig,
  clientId: string,
  userId: string,
  scope: string,
  familyId: string,
  now: Date,
) {
  const access = randomToken(ACCESS_PREFIX)
  const refresh = randomToken(REFRESH_PREFIX)
  await db.insert(oauthTokens).values({
    id: newId(),
    familyId,
    clientId,
    userId,
    accessHash: hashToken(config.appSecret, access),
    refreshHash: hashToken(config.appSecret, refresh),
    scope,
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_S * 1000),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    createdAt: now,
  })
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope,
  }
}

/** POST /oauth/token for authorization_code and refresh_token grants. */
export async function tokenGrant(
  db: DbOrTx,
  config: ServiceConfig,
  form: Record<string, string | undefined>,
  now: Date,
) {
  const grant = form.grant_type
  if (grant === 'authorization_code') {
    const codeHash = hashToken(config.appSecret, form.code ?? '')
    const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, codeHash))
    if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime())
      throw new OAuthError('invalid_grant', 'The code is invalid or expired')
    await db.update(oauthCodes).set({ usedAt: now }).where(eq(oauthCodes.id, row.id))
    if (form.client_id && form.client_id !== row.clientId)
      throw new OAuthError('invalid_grant', 'The code was issued to another client')
    if (form.redirect_uri !== row.redirectUri)
      throw new OAuthError('invalid_grant', 'redirect_uri does not match')
    const verifier = form.code_verifier ?? ''
    if (verifier.length < 43 || verifier.length > 128 || s256(verifier) !== row.codeChallenge) {
      throw new OAuthError('invalid_grant', 'PKCE verification failed')
    }
    const [user] = await db.select().from(users).where(eq(users.id, row.userId))
    if (!user || user.status !== 'active')
      throw new OAuthError('invalid_grant', 'The user is not active')
    return issue(db, config, row.clientId, row.userId, row.scope, newId(), now)
  }
  if (grant === 'refresh_token') {
    const [row] = await db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.refreshHash, hashToken(config.appSecret, form.refresh_token ?? '')))
    if (row?.refreshUsedAt) {
      // Reuse of a rotated refresh token: assume it leaked and revoke the whole family.
      await db
        .update(oauthTokens)
        .set({ revokedAt: now })
        .where(and(eq(oauthTokens.familyId, row.familyId), isNull(oauthTokens.revokedAt)))
      throw new OAuthError('invalid_grant', 'The refresh token was already used')
    }
    if (!row || row.revokedAt || row.refreshExpiresAt.getTime() <= now.getTime())
      throw new OAuthError('invalid_grant', 'The refresh token is invalid or expired')
    if (form.client_id && form.client_id !== row.clientId)
      throw new OAuthError('invalid_grant', 'The refresh token was issued to another client')
    const [user] = await db.select().from(users).where(eq(users.id, row.userId))
    if (!user || user.status !== 'active')
      throw new OAuthError('invalid_grant', 'The user is not active')
    await db
      .update(oauthTokens)
      .set({ refreshUsedAt: now, revokedAt: now })
      .where(eq(oauthTokens.id, row.id))
    return issue(db, config, row.clientId, row.userId, row.scope, row.familyId, now)
  }
  throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token')
}

/** RFC 7009: always succeeds; revokes the whole family of the given access or refresh token. */
export async function revokeToken(
  db: DbOrTx,
  config: ServiceConfig,
  token: string,
  now: Date,
): Promise<void> {
  const h = hashToken(config.appSecret, token)
  const column = token.startsWith(REFRESH_PREFIX) ? oauthTokens.refreshHash : oauthTokens.accessHash
  const [row] = await db.select().from(oauthTokens).where(eq(column, h))
  if (row)
    await db
      .update(oauthTokens)
      .set({ revokedAt: now })
      .where(and(eq(oauthTokens.familyId, row.familyId), isNull(oauthTokens.revokedAt)))
}

export async function authenticateOAuthAccess(
  db: DbOrTx,
  config: ServiceConfig,
  token: string,
  now: Date,
  via: Via,
): Promise<Actor | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null
  const [row] = await db
    .select({ t: oauthTokens, user: users })
    .from(oauthTokens)
    .innerJoin(users, eq(users.id, oauthTokens.userId))
    .where(eq(oauthTokens.accessHash, hashToken(config.appSecret, token)))
  if (
    !row ||
    row.t.revokedAt ||
    row.t.accessExpiresAt.getTime() <= now.getTime() ||
    row.user.status !== 'active'
  )
    return null
  if (!row.t.lastUsedAt || now.getTime() - row.t.lastUsedAt.getTime() > 60_000) {
    await db.update(oauthTokens).set({ lastUsedAt: now }).where(eq(oauthTokens.id, row.t.id))
  }
  return { userId: row.user.id, name: row.user.name, isAdmin: row.user.isAdmin, via }
}

export interface OAuthGrantDto {
  clientId: string
  clientName: string
  createdAt: string
  lastUsedAt: string | null
}

/** Apps the user has connected (clients with at least one live token family). */
export async function listGrants(ctx: ServiceContext): Promise<OAuthGrantDto[]> {
  const actor = requireActor(ctx)
  const rows = await ctx.db
    .select({ t: oauthTokens, name: oauthClients.clientName })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.clientId, oauthTokens.clientId))
    .where(and(eq(oauthTokens.userId, actor.userId), isNull(oauthTokens.revokedAt)))
    .orderBy(desc(oauthTokens.createdAt))
  const byClient = new Map<string, OAuthGrantDto>()
  for (const { t, name } of rows) {
    const cur = byClient.get(t.clientId)
    const last = t.lastUsedAt?.toISOString() ?? null
    if (!cur)
      byClient.set(t.clientId, {
        clientId: t.clientId,
        clientName: name,
        createdAt: t.createdAt.toISOString(),
        lastUsedAt: last,
      })
    else if (last && (!cur.lastUsedAt || last > cur.lastUsedAt)) cur.lastUsedAt = last
  }
  return [...byClient.values()]
}

export async function revokeGrant(ctx: ServiceContext, clientId: string): Promise<void> {
  const actor = requireActor(ctx)
  const rows = await ctx.db
    .update(oauthTokens)
    .set({ revokedAt: ctx.now() })
    .where(
      and(
        eq(oauthTokens.userId, actor.userId),
        eq(oauthTokens.clientId, clientId),
        isNull(oauthTokens.revokedAt),
      ),
    )
    .returning()
  if (rows.length === 0) throw notFound('No connection to that app')
  await audit(ctx.db, ctx, {
    action: 'oauth.revoke',
    targetType: 'oauth_client',
    after: { clientId },
  })
}
