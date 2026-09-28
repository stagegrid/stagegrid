import { createHash, randomBytes } from 'node:crypto'

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { describe, expect, it } from 'vitest'

import { APP_ORIGIN, browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()
const REDIRECT = 'https://claude.example/api/mcp/auth_callback'

async function world() {
  const { app } = makeApp(getDb())
  const b = browser(app)
  await b.post('/api/v1/setup', SETUP_BODY)
  await b.post('/api/v1/projects', { name: 'Pilot' })
  const fetchViaApp: typeof fetch = (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    return Promise.resolve(app.fetch(req))
  }
  return { app, b, fetchViaApp }
}

const form = (o: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(o).toString(),
})

describe('OAuth discovery', () => {
  it('publishes protected-resource and authorization-server metadata, and 401s point to it', async () => {
    const { app } = await world()
    const pr = await (await app.request('/.well-known/oauth-protected-resource/mcp')).json()
    expect(pr).toMatchObject({ resource: `${APP_ORIGIN}/mcp`, authorization_servers: [APP_ORIGIN] })
    const as = await (await app.request('/.well-known/oauth-authorization-server')).json()
    expect(as).toMatchObject({
      issuer: APP_ORIGIN,
      code_challenge_methods_supported: ['S256'],
      registration_endpoint: `${APP_ORIGIN}/oauth/register`,
    })
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${APP_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    )
  })
})

describe('authorization code flow with PKCE', () => {
  it('registers, gets consent, exchanges the code, calls MCP, rotates and detects refresh reuse', async () => {
    const { app, b } = await world()
    const reg = (await (
      await app.request('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }),
      })
    ).json()) as { client_id: string }
    expect(
      (
        await app.request('/oauth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
        })
      ).status,
    ).toBe(400)

    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const query = {
      response_type: 'code',
      client_id: reg.client_id,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      resource: `${APP_ORIGIN}/mcp`,
    }
    const authorize = await app.request(`/oauth/authorize?${new URLSearchParams(query)}`)
    expect(authorize.status).toBe(302)
    expect(authorize.headers.get('location')).toMatch(new RegExp(`^${APP_ORIGIN}/authorize\\?`))
    expect(
      (
        await app.request(
          `/oauth/authorize?${new URLSearchParams({ ...query, redirect_uri: 'https://other.example/cb' })}`,
        )
      ).status,
    ).toBe(400)

    const info = await (await b.get(`/api/v1/oauth/client?${new URLSearchParams(query)}`)).json()
    expect(info).toEqual({
      clientName: 'Claude',
      redirectHost: 'claude.example',
      scope: 'stagegrid',
    })
    const { redirect } = (await (
      await b.post('/api/v1/oauth/consent', { query, approve: true })
    ).json()) as { redirect: string }
    const back = new URL(redirect)
    expect(back.origin + back.pathname).toBe(REDIRECT)
    expect(back.searchParams.get('state')).toBe('xyz')
    const code = back.searchParams.get('code')!

    const bad = await app.request(
      '/oauth/token',
      form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: reg.client_id,
        code_verifier: 'x'.repeat(43),
      }),
    )
    expect(await bad.json()).toMatchObject({ error: 'invalid_grant' })
    // The failed attempt burned the code (single use); run consent again for a fresh one.
    const { redirect: redirect2 } = (await (
      await b.post('/api/v1/oauth/consent', { query, approve: true })
    ).json()) as { redirect: string }
    const code2 = new URL(redirect2).searchParams.get('code')!
    const tokens = (await (
      await app.request(
        '/oauth/token',
        form({
          grant_type: 'authorization_code',
          code: code2,
          redirect_uri: REDIRECT,
          client_id: reg.client_id,
          code_verifier: verifier,
        }),
      )
    ).json()) as OAuthTokens
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600 })
    expect(tokens.access_token).toMatch(/^sg_oat_/)

    const me = await app.request('/api/v1/me', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    })
    expect(me.status).toBe(200)

    const refreshed = (await (
      await app.request(
        '/oauth/token',
        form({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token!,
          client_id: reg.client_id,
        }),
      )
    ).json()) as OAuthTokens
    expect(refreshed.access_token).not.toBe(tokens.access_token)
    expect(
      (
        await app.request('/api/v1/me', {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        })
      ).status,
    ).toBe(401)
    const reuse = await app.request(
      '/oauth/token',
      form({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token!,
        client_id: reg.client_id,
      }),
    )
    expect(await reuse.json()).toMatchObject({ error: 'invalid_grant' })
    // Reuse revoked the whole family, including the newest access token.
    expect(
      (
        await app.request('/api/v1/me', {
          headers: { authorization: `Bearer ${refreshed.access_token}` },
        })
      ).status,
    ).toBe(401)
  })

  it('denial redirects with access_denied; grants can be listed and revoked', async () => {
    const { app, b } = await world()
    const reg = (await (
      await app.request('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [REDIRECT] }),
      })
    ).json()) as { client_id: string }
    const verifier = randomBytes(32).toString('base64url')
    const query = {
      response_type: 'code',
      client_id: reg.client_id,
      redirect_uri: REDIRECT,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }
    const denied = (await (
      await b.post('/api/v1/oauth/consent', { query, approve: false })
    ).json()) as { redirect: string }
    expect(new URL(denied.redirect).searchParams.get('error')).toBe('access_denied')
    const { redirect } = (await (
      await b.post('/api/v1/oauth/consent', { query, approve: true })
    ).json()) as { redirect: string }
    const tokens = (await (
      await app.request(
        '/oauth/token',
        form({
          grant_type: 'authorization_code',
          code: new URL(redirect).searchParams.get('code')!,
          redirect_uri: REDIRECT,
          client_id: reg.client_id,
          code_verifier: verifier,
        }),
      )
    ).json()) as OAuthTokens
    const grants = (await (await b.get('/api/v1/me/oauth-grants')).json()) as {
      clientId: string
      clientName: string
    }[]
    expect(grants).toEqual([
      expect.objectContaining({ clientId: reg.client_id, clientName: 'ChatGPT' }),
    ])
    expect((await b.delete(`/api/v1/me/oauth-grants/${reg.client_id}`)).status).toBe(204)
    expect(
      (
        await app.request('/api/v1/me', {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        })
      ).status,
    ).toBe(401)
  })
})

describe('MCP SDK OAuth client interoperability', () => {
  it('discovers, registers, authorizes, and calls tools like a real MCP client', async () => {
    const { b, fetchViaApp } = await world()
    let clientInfo: OAuthClientInformationMixed | undefined
    let saved: OAuthTokens | undefined
    let verifier = ''
    let authUrl: URL | undefined
    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return REDIRECT
      },
      get clientMetadata() {
        return {
          client_name: 'SDK test',
          redirect_uris: [REDIRECT],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }
      },
      clientInformation: () => clientInfo,
      saveClientInformation: (i) => {
        clientInfo = i
      },
      tokens: () => saved,
      saveTokens: (t) => {
        saved = t
      },
      redirectToAuthorization: (url) => {
        authUrl = url
      },
      saveCodeVerifier: (v) => {
        verifier = v
      },
      codeVerifier: () => verifier,
    }
    const url = new URL(`${APP_ORIGIN}/mcp`)
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider: provider,
      fetch: fetchViaApp,
    })
    const client = new Client({ name: 'sdk', version: '0' })
    await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError)
    expect(authUrl?.origin + authUrl!.pathname).toBe(`${APP_ORIGIN}/oauth/authorize`)

    // The user signs in to Stagegrid and clicks Allow.
    const query = Object.fromEntries(authUrl!.searchParams.entries())
    const { redirect } = (await (
      await b.post('/api/v1/oauth/consent', { query, approve: true })
    ).json()) as { redirect: string }
    await transport.finishAuth(new URL(redirect).searchParams.get('code')!)

    const client2 = new Client({ name: 'sdk', version: '0' })
    await client2.connect(
      new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: fetchViaApp }),
    )
    const res = await client2.callTool({ name: 'list_projects', arguments: {} })
    expect(JSON.stringify(res)).toContain('pilot')
    expect(StreamableHTTPError).toBeDefined()
  })
})
