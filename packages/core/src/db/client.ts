import { fileURLToPath } from 'node:url'

import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

export interface Database {
  db: Db
  sql: postgres.Sql
  close(): Promise<void>
}

export function createDatabase(url: string, options: { max?: number } = {}): Database {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => {} })
  const db = drizzle(client, { schema })
  return { db, sql: client, close: () => client.end({ timeout: 5 }) }
}

/** Directory holding drizzle SQL migrations: src/db/migrations in dev, dist/migrations when built. */
export function migrationsFolder(): string {
  return fileURLToPath(new URL('./migrations', import.meta.url))
}

/**
 * Runs pending migrations on a dedicated single connection while holding a session-level advisory
 * lock, so several instances starting at once migrate one after another.
 */
export async function runMigrations(
  databaseUrl: string,
  folder = migrationsFolder(),
): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  try {
    await client`select pg_advisory_lock(hashtext('stagegrid:migrate'))`
    await migrate(drizzle(client), { migrationsFolder: folder })
    await client`select pg_advisory_unlock(hashtext('stagegrid:migrate'))`
  } finally {
    await client.end({ timeout: 5 })
  }
}

export async function ping(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}
