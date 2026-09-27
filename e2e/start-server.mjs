// Recreates the e2e database, then starts the built server (run `pnpm build` first).
import { spawn } from 'node:child_process'

import postgres from 'postgres'

const url = new URL(process.env.E2E_DATABASE_URL)
const dbName = url.pathname.slice(1)
const admin = new URL(url)
admin.pathname = '/postgres'
const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} })
await sql.unsafe(`drop database if exists "${dbName}" with (force)`)
await sql.unsafe(`create database "${dbName}"`)
await sql.end()

const port = process.env.PORT ?? '4173'
const child = spawn(process.execPath, ['packages/core/dist/cli.js', 'start'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: url.toString(),
    APP_URL: `http://localhost:${port}`,
    APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
    PORT: port,
    LOG_LEVEL: 'warn',
  },
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code) => process.exit(code ?? 0))
