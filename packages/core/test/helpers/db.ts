import { afterAll, beforeEach } from 'vitest'

import { createDatabase, type Database } from '../../src/db/client'
import { TEST_DATABASE_URL } from './env'

let database: Database | null = null

/** Shared connection for a test file; tables are truncated before every test. */
export function useTestDatabase(): () => Database {
  beforeEach(async () => {
    database ??= createDatabase(TEST_DATABASE_URL, { max: 5 })
    await truncateAll(database)
  })
  afterAll(async () => {
    await database?.close()
    database = null
  })
  return () => {
    if (!database) throw new Error('useTestDatabase: database not ready (call inside a test)')
    return database
  }
}

export async function truncateAll(db: Database): Promise<void> {
  const rows = await db.sql<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`
  if (rows.length === 0) return
  const list = rows.map((r) => `"${r.tablename}"`).join(', ')
  await db.sql.unsafe(`truncate ${list} restart identity cascade`)
}
