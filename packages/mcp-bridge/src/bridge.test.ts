import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createBridge } from './bridge'

async function linked(server: { connect: (t: InMemoryTransport) => Promise<void> }) {
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await server.connect(a)
  await client.connect(b)
  return client
}

describe('createBridge', () => {
  it('forwards tools, prompts, resources, and instructions', async () => {
    const remote = new McpServer(
      { name: 'stagegrid', version: '9.9.9' },
      { instructions: 'be careful' },
    )
    remote.registerTool('echo', { inputSchema: { text: z.string() } }, ({ text }) => ({
      content: [{ type: 'text', text: `echo ${text}` }],
    }))
    remote.registerPrompt('guide', { description: 'g' }, () => ({
      messages: [{ role: 'user', content: { type: 'text', text: 'rules' } }],
    }))
    remote.registerResource(
      'guide',
      'stagegrid://guide',
      { mimeType: 'text/markdown' },
      async (uri) => ({ contents: [{ uri: uri.href, text: '# guide' }] }),
    )
    const remoteClient = await linked(remote)

    const local = await linked(createBridge(remoteClient))
    expect(local.getServerVersion()).toMatchObject({ name: 'stagegrid', version: '9.9.9' })
    expect(local.getInstructions()).toBe('be careful')
    expect((await local.listTools()).tools.map((t) => t.name)).toEqual(['echo'])
    expect(await local.callTool({ name: 'echo', arguments: { text: 'hi' } })).toMatchObject({
      content: [{ type: 'text', text: 'echo hi' }],
    })
    expect((await local.getPrompt({ name: 'guide' })).messages[0]).toMatchObject({
      content: { text: 'rules' },
    })
    expect((await local.readResource({ uri: 'stagegrid://guide' })).contents[0]).toMatchObject({
      text: '# guide',
    })
  })
})
