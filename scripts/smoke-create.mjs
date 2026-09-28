// CI smoke test: scaffold with create-stagegrid, install the locally packed core, start it, hit /healthz.
// Run after `pnpm build`. Needs Postgres (SMOKE_DATABASE_URL or the dev compose DB on port 54329).
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import postgres from 'postgres'

const root = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'stagegrid-smoke-'))
const dbUrl =
  process.env.SMOKE_DATABASE_URL ?? 'postgres://stagegrid:stagegrid@localhost:54329/stagegrid_smoke'
const port = 4099

const u = new URL(dbUrl)
const adminUrl = new URL(dbUrl)
adminUrl.pathname = '/postgres'
const sql = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} })
await sql.unsafe(`drop database if exists "${u.pathname.slice(1)}" with (force)`)
await sql.unsafe(`create database "${u.pathname.slice(1)}"`)
await sql.end()

execFileSync('pnpm', ['pack', '--pack-destination', work], {
  cwd: join(root, 'packages/core'),
  stdio: 'inherit',
})
const tgz = readdirSync(work).find((f) => f.endsWith('.tgz'))
execFileSync(
  process.execPath,
  [
    join(root, 'packages/create-stagegrid/dist/index.js'),
    'app',
    '--db-url',
    dbUrl,
    '--skip-install',
  ],
  { cwd: work, stdio: 'inherit' },
)
const app = join(work, 'app')
const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
pkg.dependencies['@stagegrid/core'] = `file:${join(work, tgz)}`
writeFileSync(join(app, 'package.json'), JSON.stringify(pkg, null, 2))
const env = readFileSync(join(app, '.env'), 'utf8').replace(
  'APP_URL=http://localhost:4000',
  `APP_URL=http://localhost:${port}`,
)
writeFileSync(join(app, '.env'), `${env}PORT=${port}\n`)
execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit' })

const server = spawn(join(app, 'node_modules/.bin/stagegrid'), ['start'], {
  cwd: app,
  stdio: 'inherit',
})
let ok = false
for (let i = 0; i < 30 && !ok; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  ok = await fetch(`http://localhost:${port}/healthz`)
    .then((r) => r.ok)
    .catch(() => false)
}
server.kill('SIGTERM')
if (!ok) {
  console.error('smoke: server did not become healthy')
  process.exit(1)
}
console.log('smoke: create-stagegrid → start → /healthz OK')
