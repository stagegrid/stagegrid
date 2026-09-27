import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'
import type { Logger } from 'pino'

import type { Config } from './config/config'
import { createDatabase, type Database, runMigrations } from './db/client'
import { createApp } from './http/app'
import { createRateLimiter } from './http/middleware/rate-limit'
import { SseHub } from './realtime/hub'
import { startListener } from './realtime/listener'
import { ensureBuiltinTemplates } from './services/docs.service'
import { needsSetup } from './services/settings.service'

const RETRIES = 10
const RETRY_DELAY_MS = 2000

/** Built admin SPA shipped inside the package (dist/admin next to dist/cli.js). */
export function defaultStaticDir(): string {
  return fileURLToPath(new URL('./admin', import.meta.url))
}

async function connectWithRetry(config: Config, logger: Logger): Promise<Database> {
  for (let attempt = 1; ; attempt++) {
    const database = createDatabase(config.databaseUrl)
    try {
      await database.sql`select 1`
      return database
    } catch (err) {
      await database.close().catch(() => {})
      if (attempt >= RETRIES) throw err
      logger.warn({ attempt, err: (err as Error).message }, 'database not reachable yet, retrying')
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
}

export interface RunningServer {
  url: string
  close(): Promise<void>
}

export async function startServer(
  config: Config,
  logger: Logger,
  opts: { staticDir?: string } = {},
): Promise<RunningServer> {
  const database = await connectWithRetry(config, logger)
  logger.info('running migrations')
  await runMigrations(config.databaseUrl)
  await ensureBuiltinTemplates(database.db)
  const hub = new SseHub()
  const stopListener = await startListener(config.databaseUrl, hub, logger)
  const app = createApp({
    database,
    config,
    logger,
    hub,
    now: () => new Date(),
    loginLimiter: createRateLimiter(10, 15 * 60_000),
    publicLimiter: createRateLimiter(50, 15 * 60_000),
    staticDir: opts.staticDir ?? defaultStaticDir(),
  })
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  logger.info(`Stagegrid is running at ${config.appUrl}`)
  if (await needsSetup(database.db))
    logger.info(`Open ${config.appUrl}/setup to create the first admin`)

  let closing: Promise<void> | null = null
  return {
    url: config.appUrl,
    close: () =>
      (closing ??= (async () => {
        hub.closeAll()
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 10_000)
          server.close(() => {
            clearTimeout(timer)
            resolve()
          })
        })
        await stopListener()
        await database.close()
      })()),
  }
}
