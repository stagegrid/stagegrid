import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { ServiceContext } from '../services/context'
import { guideText, syncText } from './skill'
import { registerReadTools } from './tools/read'
import { registerWriteTools } from './tools/write'

export const MCP_SERVER_INFO = { name: 'stagegrid', version: '0.2.0' }

/** One server per request (stateless transport), bound to the authenticated actor. */
export function createMcpServer(ctx: ServiceContext): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions:
      'Stagegrid tracks project progress as items × stages. Read the "stagegrid-guide" prompt or resource first. Always preview multi-item or imported updates with apply_changes dryRun: true and wait for the user to confirm.',
  })
  registerReadTools(server, ctx)
  registerWriteTools(server, ctx)

  server.registerResource(
    'guide',
    'stagegrid://guide',
    {
      title: 'Stagegrid guide',
      description: 'How to read and update Stagegrid correctly',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guideText() }],
    }),
  )
  server.registerPrompt(
    'stagegrid-guide',
    { title: 'Stagegrid guide', description: 'Load the rules for working with Stagegrid' },
    () => ({ messages: [{ role: 'user', content: { type: 'text', text: guideText() } }] }),
  )
  server.registerPrompt(
    'sync-from-tracker',
    {
      title: 'Sync from another tracker',
      description: 'Update Stagegrid from Jira, Linear, GitHub… with a preview the user confirms',
      argsSchema: { source: z.string().describe('e.g. "Jira project ABC"') },
    },
    ({ source }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: syncText(source) } }],
    }),
  )
  return server
}
