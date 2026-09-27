import postgres from 'postgres'

import { runMigrations } from '../../src/db/client'
import { TEST_DATABASE_URL } from './env'

/** Creates the test database if needed and migrates it once per vitest run. */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL)
  const dbName = url.pathname.slice(1)
  const adminUrl = new URL(TEST_DATABASE_URL)
  adminUrl.pathname = '/postgres'
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} })
  try {
    const rows = await admin`select 1 from pg_database where datname = ${dbName}`
    if (rows.length === 0) await admin.unsafe(`create database "${dbName}"`)
  } finally {
    await admin.end()
  }
  await runMigrations(TEST_DATABASE_URL)
}
