#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { Command } from 'commander'

import { ConfigError, loadConfig } from '../config/config'
import { createDatabase, runMigrations } from '../db/client'
import { createLogger } from '../logger'
import { startServer } from '../server'
import { createResetLinkForEmail } from '../services/users.service'

function loadEnvFile(): void {
  const file = resolve(process.cwd(), '.env')
  if (existsSync(file)) process.loadEnvFile(file)
}

function config() {
  loadEnvFile()
  try {
    return loadConfig()
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message)
      console.error('Set these in .env or the environment. See README → Configuration.')
      process.exit(1)
    }
    throw e
  }
}

async function run(dev: boolean): Promise<void> {
  if (dev) process.env.NODE_ENV ??= 'development'
  const cfg = config()
  const logger = createLogger(cfg, dev)
  const server = await startServer(cfg, logger)
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down')
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}

const program = new Command().name('stagegrid').description('Stagegrid server')

program
  .command('start')
  .description('Run migrations and start the server')
  .action(() => run(false))
program
  .command('dev')
  .description('Like start, with pretty logs')
  .action(() => run(true))
program
  .command('migrate')
  .description('Run database migrations and exit')
  .action(async () => {
    const cfg = config()
    await runMigrations(cfg.databaseUrl)
    console.log('Migrations are up to date')
  })
program
  .command('admin:reset-link')
  .argument('<email>', 'email of the user')
  .description('Print a one-time password reset link (valid 24 hours)')
  .action(async (email: string) => {
    const cfg = config()
    const database = createDatabase(cfg.databaseUrl, { max: 1 })
    try {
      const res = await createResetLinkForEmail(
        { db: database.db, actor: null, now: () => new Date(), config: cfg },
        email,
      )
      console.log(`Reset link (expires ${res.expiresAt}):\n${res.link}`)
    } catch (e) {
      console.error((e as Error).message)
      process.exitCode = 1
    } finally {
      await database.close()
    }
  })

await program.parseAsync()
