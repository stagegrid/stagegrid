import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'

import {
  consent,
  listGrants,
  mcpResource,
  OAuthError,
  registerClient,
  revokeGrant,
  revokeToken,
  SCOPE,
  tokenGrant,
  validateAuthorize,
} from '../../services/oauth.service'
import { body, clientIp, requireAuth, serviceCtx } from '../context'
import type { AppEnv } from '../env'
import { errorResponse } from '../errors'

type Redirectable = OAuthError & {
  redirectable?: boolean
  redirectUri?: string
  state?: string | null
}

const oauthJson = (e: OAuthError) => ({ error: e.error, error_description: e.description })

async function formOrJson(req: Request): Promise<Record<string, string | undefined>> {
  const type = req.headers.get('content-type') ?? ''
  if (type.includes('application/json')) return (await req.json()) as Record<string, string>
  const params = new URLSearchParams(await req.text())
  return Object.fromEntries(params.entries())
}

/** Discovery documents and OAuth endpoints (spec 04 §8). Public; no cookies involved. */
export const oauthRoutes = new Hono<AppEnv>()
  .use('/.well-known/*', cors())
  .use('/oauth/register', cors())
  .use('/oauth/token', cors())
  .use('/oauth/revoke', cors())
  .get('/.well-known/oauth-protected-resource/*', (c) =>
    c.json(protectedResource(c.get('deps').config.appUrl)),
  )
  .get('/.well-known/oauth-protected-resource', (c) =>
    c.json(protectedResource(c.get('deps').config.appUrl)),
  )
  .get('/.well-known/oauth-authorization-server', (c) => {
    const base = c.get('deps').config.appUrl
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE],
    })
  })
  .post('/oauth/register', async (c) => {
    const deps = c.get('deps')
    const wait = deps.publicLimiter.hit(`register:${clientIp(c)}`)
    if (wait > 0)
      return c.json({ error: 'slow_down', error_description: 'Too many registrations' }, 429)
    try {
      return c.json(
        await registerClient(
          deps.database.db,
          (await c.req.json()) as Record<string, unknown>,
          deps.now(),
        ),
        201,
      )
    } catch (e) {
      if (e instanceof OAuthError) return c.json(oauthJson(e), 400)
      if (e instanceof SyntaxError)
        return c.json(
          { error: 'invalid_client_metadata', error_description: 'Body must be JSON' },
          400,
        )
      throw e
    }
  })
  .get('/oauth/authorize', async (c) => {
    const deps = c.get('deps')
    try {
      await validateAuthorize(deps.database.db, deps.config, c.req.query())
    } catch (e) {
      const err = e as Redirectable
      if (!(err instanceof OAuthError)) throw e
      if (err.redirectable && err.redirectUri) {
        const u = new URL(err.redirectUri)
        u.searchParams.set('error', err.error)
        u.searchParams.set('error_description', err.description)
        if (err.state) u.searchParams.set('state', err.state)
        return c.redirect(u.toString())
      }
      return c.text(`Can't connect this app: ${err.description}`, 400)
    }
    // Valid request: the signed-in consent screen lives in the web app.
    const query = new URL(c.req.url).search
    return c.redirect(`${deps.config.appUrl}/authorize${query}`)
  })
  .post('/oauth/token', async (c) => {
    const deps = c.get('deps')
    c.header('Cache-Control', 'no-store')
    try {
      return c.json(
        await tokenGrant(deps.database.db, deps.config, await formOrJson(c.req.raw), deps.now()),
      )
    } catch (e) {
      if (e instanceof OAuthError) return c.json(oauthJson(e), 400)
      throw e
    }
  })
  .post('/oauth/revoke', async (c) => {
    const deps = c.get('deps')
    const form = await formOrJson(c.req.raw)
    if (form.token) await revokeToken(deps.database.db, deps.config, form.token, deps.now())
    return c.body(null, 200)
  })

function protectedResource(appUrl: string) {
  return {
    resource: mcpResource({ appUrl }),
    authorization_servers: [appUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
    resource_name: 'Stagegrid',
  }
}

const consentInput = z.object({
  query: z.record(z.string(), z.string()),
  approve: z.boolean(),
})

/** Cookie-authenticated helpers for the consent screen and Profile → Connected apps. */
export const oauthApiRoutes = new Hono<AppEnv>()
  .get('/oauth/client', async (c) => {
    requireAuth(c)
    const deps = c.get('deps')
    try {
      const { params, clientName } = await validateAuthorize(
        deps.database.db,
        deps.config,
        c.req.query(),
      )
      return c.json({
        clientName,
        redirectHost: new URL(params.redirectUri).host,
        scope: params.scope,
      })
    } catch (e) {
      if (e instanceof OAuthError) return errorResponse(c, 'validation_error', e.description)
      throw e
    }
  })
  .post('/oauth/consent', async (c) => {
    requireAuth(c)
    const deps = c.get('deps')
    const input = await body(c, consentInput)
    try {
      const { params } = await validateAuthorize(deps.database.db, deps.config, input.query)
      return c.json(await consent(serviceCtx(c), params, input.approve))
    } catch (e) {
      if (e instanceof OAuthError) return errorResponse(c, 'validation_error', e.description)
      throw e
    }
  })
  .get('/me/oauth-grants', async (c) => c.json(await listGrants(serviceCtx(c))))
  .delete('/me/oauth-grants/:clientId', async (c) => {
    await revokeGrant(serviceCtx(c), c.req.param('clientId'))
    return c.body(null, 204)
  })
