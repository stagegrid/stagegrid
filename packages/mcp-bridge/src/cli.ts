#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createBridge } from './bridge'

const { values } = parseArgs({ options: { url: { type: 'string' }, token: { type: 'string' } } })
const url = values.url ?? process.env.STAGEGRID_URL
const token = values.token ?? process.env.STAGEGRID_TOKEN

if (!url || !token) {
  console.error('Usage: npx -y @stagegrid/mcp --url https://pm.example.com/mcp --token sg_pat_…')
  console.error('   or: STAGEGRID_URL=… STAGEGRID_TOKEN=… npx -y @stagegrid/mcp')
  process.exit(1)
}

const remote = new Client({ name: 'stagegrid-mcp-bridge', version: '0.0.0' })
try {
  await remote.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
} catch (e) {
  console.error(`Couldn't connect to ${url}: ${(e as Error).message}`)
  console.error('Check the URL (it ends with /mcp) and that the token is valid and not revoked.')
  process.exit(1)
}
await createBridge(remote).connect(new StdioServerTransport())
