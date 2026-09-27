import { type ProjectRole, ROLE_RANK } from '@stagegrid/shared'
import { and, eq, or } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { projectMembers, projects } from '../db/schema'
import { conflict, forbidden, notFound } from '../errors'
import { isUuid } from '../lib/ids'
import { type Actor, requireActor, type ServiceContext } from './context'

export type ProjectRow = typeof projects.$inferSelect

export function requireAdmin(ctx: ServiceContext): Actor {
  const actor = requireActor(ctx)
  if (!actor.isAdmin) throw forbidden()
  return actor
}

export async function findProject(db: DbOrTx, ref: string): Promise<ProjectRow | null> {
  const where = isUuid(ref)
    ? or(eq(projects.id, ref), eq(projects.slug, ref))
    : eq(projects.slug, ref.toLowerCase())
  const [row] = await db.select().from(projects).where(where).limit(1)
  return row ?? null
}

export async function roleIn(
  db: DbOrTx,
  actor: Actor,
  projectId: string,
): Promise<ProjectRole | null> {
  if (actor.isAdmin) return 'owner'
  const [m] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.userId)))
    .limit(1)
  return m?.role ?? null
}

export interface ProjectAccess {
  project: ProjectRow
  role: ProjectRole
  actor: Actor
}

/**
 * Resolves a project by id or slug and checks the actor's role. Projects the actor can't see at all
 * answer not_found so their existence isn't revealed. Writes to archived projects are refused unless
 * `allowArchived` is set.
 */
export async function requireProjectRole(
  ctx: ServiceContext,
  ref: string,
  min: ProjectRole,
  opts: { allowArchived?: boolean } = {},
): Promise<ProjectAccess> {
  const actor = requireActor(ctx)
  const project = await findProject(ctx.db, ref)
  if (!project) throw notFound('Project not found')
  const role = await roleIn(ctx.db, actor, project.id)
  if (!role) throw notFound('Project not found')
  if (ROLE_RANK[role] < ROLE_RANK[min]) throw forbidden()
  if (project.archivedAt && min !== 'viewer' && !opts.allowArchived) {
    throw conflict('This project is archived. Unarchive it to make changes.')
  }
  return { project, role, actor }
}
