import { createHash, randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

const REDIRECT = 'https://claude.example/api/mcp/auth_callback'

test('an MCP client connects through sign-in and consent (OAuth 2.1 + PKCE)', async ({
  page,
  request,
  baseURL,
}) => {
  const reg = await (
    await request.post('/oauth/register', {
      data: { client_name: 'Claude', redirect_uris: [REDIRECT] },
    })
  ).json()
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorize = `/oauth/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: reg.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'e2e',
    resource: `${baseURL}/mcp`,
  })}`

  let callback = ''
  await page.route('https://claude.example/**', async (route) => {
    callback = route.request().url()
    await route.fulfill({ status: 200, body: 'ok' })
  })

  await signIn(page)
  await page.goto(authorize)
  await expect(page.getByText('Connect Claude')).toBeVisible()
  await expect(page.getByText(/read and update the projects you have access to/)).toBeVisible()
  await page.getByRole('button', { name: 'Allow' }).click()
  await expect.poll(() => callback).toContain('code=')
  const params = new URL(callback).searchParams
  expect(params.get('state')).toBe('e2e')

  const tokens = await (
    await request.post('/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        code: params.get('code')!,
        redirect_uri: REDIRECT,
        client_id: reg.client_id,
        code_verifier: verifier,
      },
    })
  ).json()
  expect(tokens.access_token).toMatch(/^sg_oat_/)

  const mcp = await request.post('/mcp', {
    headers: {
      authorization: `Bearer ${tokens.access_token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_projects', arguments: {} },
    },
  })
  expect(JSON.stringify(await mcp.json())).toContain('clinic-os')

  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeVisible()
  await expect(page.getByText('Claude', { exact: true })).toBeVisible()
})
