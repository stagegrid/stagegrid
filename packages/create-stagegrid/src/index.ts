#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'

import { scaffoldFiles } from './files'

const CORE_VERSION = process.env.STAGEGRID_CORE_VERSION ?? '0.1.0'

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      'db-url': { type: 'string' },
      'skip-install': { type: 'boolean', default: false },
      pm: { type: 'string' },
    },
  })
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = async (q: string, fallback: string) =>
    process.stdin.isTTY ? (await rl.question(`${q} (${fallback}) `)).trim() || fallback : fallback

  const dirArg = positionals[0] ?? (await ask('Project folder?', 'my-stagegrid'))
  const dir = resolve(dirArg)
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    console.error(`${dirArg} already exists and isn't empty. Pick another folder.`)
    process.exit(1)
  }
  let db = values.db as 'docker' | 'url' | undefined
  if (values['db-url']) db = 'url'
  if (!db)
    db =
      (await ask('Database: [1] start Postgres with Docker, [2] I have a DATABASE_URL', '1')) ===
      '2'
        ? 'url'
        : 'docker'
  let databaseUrl = values['db-url']
  if (db === 'url' && !databaseUrl)
    databaseUrl = await ask('DATABASE_URL', 'postgres://user:pass@localhost:5432/stagegrid')
  rl.close()

  mkdirSync(dir, { recursive: true })
  const files = scaffoldFiles({ name: basename(dir), coreVersion: CORE_VERSION, db, databaseUrl })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  console.log(`Created ${dirArg}`)

  const pm = values.pm ?? (process.env.npm_config_user_agent?.split('/')[0] || 'npm')
  if (!values['skip-install']) {
    const r = spawnSync(pm, ['install'], {
      cwd: dir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (r.status !== 0) console.warn(`${pm} install failed — run it yourself inside ${dirArg}.`)
  }
  console.log(`
Next steps:
  cd ${dirArg}
${db === 'docker' ? '  docker compose up -d db\n' : ''}  ${pm} run dev
  → open http://localhost:4000/setup
`)
}

await main()
