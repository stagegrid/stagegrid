import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'

import { createMcpServer } from '../../mcp/server'
import { authenticateToken } from '../../services/tokens.service'
import type { AppEnv } from '../env'
import { errorResponse } from '../errors'
import { bearerToken } from '../middleware/auth'

/**
 * MCP over Streamable HTTP, stateless: a fresh server + transport per request. Auth is a bearer
 * token (personal access token now, OAuth later). Browser-originated requests must come from APP_URL.
 */
export const mcpRoutes = new Hono<AppEnv>().all('/mcp', async (c) => {
  const deps = c.get('deps')
  const origin = c.req.header('origin')
  if (origin && origin !== deps.config.appOrigin)
    return errorResponse(c, 'forbidden', 'Origin not allowed')
  const token = bearerToken(c.req.header('authorization'))
  const actor = token
    ? await authenticateToken(deps.database.db, deps.config, token, deps.now(), 'mcp')
    : null
  if (!actor)
    return errorResponse(c, 'unauthenticated', 'Send Authorization: Bearer <Stagegrid API token>')
  const server = createMcpServer({
    db: deps.database.db,
    actor,
    now: deps.now,
    config: deps.config,
  })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})
