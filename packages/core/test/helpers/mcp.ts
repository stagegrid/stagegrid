import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { makeApp } from './app'

type App = ReturnType<typeof makeApp>['app']

/** An MCP client talking to the in-process app (no network) with a bearer token. */
export async function mcpClient(app: App, token: string): Promise<Client> {
  const fetchViaApp: typeof fetch = (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    return Promise.resolve(app.fetch(req))
  }
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost:4000/mcp'), {
      fetch: fetchViaApp,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

/** Calls a tool and returns parsed JSON, or throws with the error text when isError. */
export async function call<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult
  const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
  if (res.isError) throw new Error(text)
  return JSON.parse(text) as T
}
