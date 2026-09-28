import { eq, sql } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { instanceSettings, users } from '../db/schema'

export interface InstanceSettings {
  instanceName: string
  timezone: string
  setupCompletedAt: string | null
}

const DEFAULTS: InstanceSettings = {
  instanceName: 'Stagegrid',
  timezone: 'UTC',
  setupCompletedAt: null,
}

const KEYS = {
  instanceName: 'instance_name',
  timezone: 'timezone',
  setupCompletedAt: 'setup_completed_at',
} as const satisfies Record<keyof InstanceSettings, string>

export async function getInstanceSettings(db: DbOrTx): Promise<InstanceSettings> {
  const rows = await db.select().from(instanceSettings)
  const map = new Map(rows.map((r) => [r.key, r.value]))
  return {
    instanceName: (map.get(KEYS.instanceName) as string | undefined) ?? DEFAULTS.instanceName,
    timezone: (map.get(KEYS.timezone) as string | undefined) ?? DEFAULTS.timezone,
    setupCompletedAt: (map.get(KEYS.setupCompletedAt) as string | undefined) ?? null,
  }
}

export async function setInstanceSettings(
  db: DbOrTx,
  values: Partial<InstanceSettings>,
  now: Date,
): Promise<void> {
  for (const [field, value] of Object.entries(values) as [keyof InstanceSettings, unknown][]) {
    if (value === undefined) continue
    await db
      .insert(instanceSettings)
      .values({ key: KEYS[field], value, updatedAt: now })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: now } })
  }
}

export async function needsSetup(db: DbOrTx): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
  return (row?.n ?? 0) === 0
}

export async function getSetting(db: DbOrTx, key: string): Promise<unknown> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, key))
  return row?.value
}
