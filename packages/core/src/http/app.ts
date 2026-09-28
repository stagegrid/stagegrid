import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { ping } from '../db/client'
import type { AppDeps, AppEnv } from './env'
import { errorResponse, handleError } from './errors'
import { authMiddleware } from './middleware/auth'
import { requestId, requestLog, securityHeaders, withDeps } from './middleware/common'
import { originCheck } from './middleware/origin'
import { authRoutes } from './routes/auth'
import { mcpRoutes } from './routes/mcp'
import { oauthApiRoutes, oauthRoutes } from './routes/oauth'
import { projectRoutes } from './routes/projects'
import { releaseRoutes } from './routes/releases'
import { skillRoutes } from './routes/skill'
import { streamRoutes } from './routes/stream'
import { userRoutes } from './routes/users'

const MB = 1024 * 1024

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.onError(handleError)
  app.use('*', withDeps(deps), requestId, securityHeaders, requestLog)

  app.get('/healthz', async (c) =>
    (await ping(deps.database.db)) ? c.json({ ok: true }) : c.json({ ok: false }, 503),
  )

  app.use(
    '/mcp',
    bodyLimit({
      maxSize: 1 * MB,
      onError: (c) => errorResponse(c, 'payload_too_large', 'Request body is too large'),
    }),
  )
  app.route('/', mcpRoutes)
  app.use(
    '/oauth/*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => errorResponse(c, 'payload_too_large', 'Request body is too large'),
    }),
  )
  app.route('/', oauthRoutes)

  const api = new Hono<AppEnv>()
  api.use(
    '*',
    bodyLimit({
      maxSize: 1 * MB,
      onError: (c) => errorResponse(c, 'payload_too_large', 'Request body is too large'),
    }),
  )
  api.use('*', authMiddleware, originCheck)
  api.route('/', authRoutes)
  api.route('/', userRoutes)
  api.route('/', projectRoutes)
  api.route('/', releaseRoutes)
  api.route('/', streamRoutes)
  api.route('/', skillRoutes)
  api.route('/', oauthApiRoutes)
  api.all('*', (c) => errorResponse(c, 'not_found', 'Not found'))
  app.route('/api/v1', api)

  if (deps.staticDir && existsSync(deps.staticDir)) {
    const root = deps.staticDir
    app.use('/*', serveStatic({ root }))
    const indexHtml = readFile(join(root, 'index.html'), 'utf8')
    app.get('*', async (c) => c.html(await indexHtml))
  }
  return app
}
