import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

/** A local MCP server that forwards tools, prompts, and resources to an already-connected remote client. */
export function createBridge(remote: Client): Server {
  const info = remote.getServerVersion() ?? { name: 'stagegrid', version: '0.0.0' }
  const server = new Server(
    { name: info.name, version: info.version },
    {
      capabilities: { tools: {}, prompts: {}, resources: {} },
      instructions: remote.getInstructions(),
    },
  )
  server.setRequestHandler(ListToolsRequestSchema, (req) => remote.listTools(req.params))
  server.setRequestHandler(CallToolRequestSchema, (req) => remote.callTool(req.params))
  server.setRequestHandler(ListPromptsRequestSchema, (req) => remote.listPrompts(req.params))
  server.setRequestHandler(GetPromptRequestSchema, (req) => remote.getPrompt(req.params))
  server.setRequestHandler(ListResourcesRequestSchema, (req) => remote.listResources(req.params))
  server.setRequestHandler(ReadResourceRequestSchema, (req) => remote.readResource(req.params))
  return server
}
