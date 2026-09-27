import type { ItemTreeInput, Via } from '@stagegrid/shared'
import { eq } from 'drizzle-orm'

import type { Database } from '../../src/db/client'
import { projectMembers, users } from '../../src/db/schema'
import { newId } from '../../src/lib/ids'
import type { Actor, ServiceContext } from '../../src/services/context'
import { createItems } from '../../src/services/items.service'
import { createProject } from '../../src/services/projects.service'
import { TEST_CONFIG } from './env'

export const FIXED_NOW = new Date('2026-10-20T03:00:00.000Z')

export function makeCtx(
  database: Database,
  actor: Actor | null,
  now: Date | (() => Date) = FIXED_NOW,
): ServiceContext {
  return {
    db: database.db,
    actor,
    now: typeof now === 'function' ? now : () => now,
    config: TEST_CONFIG,
  }
}

let counter = 0

export async function createUser(
  database: Database,
  opts: {
    name?: string
    email?: string
    isAdmin?: boolean
    status?: 'invited' | 'active' | 'disabled'
    passwordHash?: string | null
  } = {},
): Promise<Actor & { email: string }> {
  counter += 1
  const id = newId()
  const email = opts.email ?? `user${counter}@example.com`
  const name = opts.name ?? `User ${counter}`
  await database.db.insert(users).values({
    id,
    email,
    name,
    isAdmin: opts.isAdmin ?? false,
    status: opts.status ?? 'active',
    passwordHash: opts.passwordHash ?? null,
  })
  return { userId: id, name, isAdmin: opts.isAdmin ?? false, via: 'web', email }
}

export const asVia = (actor: Actor, via: Via): Actor => ({ ...actor, via })

export async function addMember(
  database: Database,
  projectId: string,
  userId: string,
  role: 'owner' | 'editor' | 'viewer',
): Promise<void> {
  await database.db.insert(projectMembers).values({ projectId, userId, role })
}

export async function getUser(database: Database, id: string) {
  const [u] = await database.db.select().from(users).where(eq(users.id, id))
  return u!
}

/** Admin-created project with the default stages (or `stages`) and an optional item tree. */
export async function seedProject(
  database: Database,
  admin: Actor,
  opts: { name?: string; tree?: ItemTreeInput[]; timezone?: string } = {},
) {
  const ctx = makeCtx(database, admin)
  const project = await createProject(ctx, {
    name: opts.name ?? 'Clinic OS',
    description: '',
    timezone: opts.timezone ?? 'UTC',
  })
  if (opts.tree?.length) await createItems(ctx, project.id, { items: opts.tree })
  return project
}
