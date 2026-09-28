import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

// Runs after board.spec.ts (same server, same database): the admin and "Clinic OS" with Login/Reports exist.
test('an AI connected over MCP updates the board live', async ({ page, baseURL }) => {
  await signIn(page)
  await page.goto('/p/clinic-os')
  await expect(page.getByRole('button', { name: 'Login, QA: To do' })).toBeVisible()

  await page.getByRole('button', { name: 'Connect AI' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('MCP URL', { exact: true })).toHaveValue(`${baseURL}/mcp`)
  await dialog.getByRole('button', { name: 'Create token for AI' }).click()
  const token = await dialog.getByLabel('token', { exact: true }).inputValue()
  expect(token).toMatch(/^sg_pat_/)
  await expect(dialog.getByLabel('Claude Code config', { exact: true })).toContainText(token)
  await page.keyboard.press('Escape')

  const client = new Client({ name: 'e2e', version: '0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  const res = await client.callTool({
    name: 'apply_changes',
    arguments: {
      project: 'clinic-os',
      changes: [{ item: 'Login', stage: 'QA', status: 'doing', reason: 'started by AI' }],
    },
  })
  expect(res.isError).toBeFalsy()
  await client.close()

  await expect(page.getByRole('button', { name: 'Login, QA: Doing' })).toBeVisible({
    timeout: 2000,
  })
  await expect(page.getByText(/via MCP · Login › QA → Doing/)).toBeVisible()
})
