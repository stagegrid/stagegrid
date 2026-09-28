import {
  type CreateProjectInput,
  DEFAULT_STAGES,
  type ProjectDto,
  type ProjectRole,
  type UpdateProjectInput,
} from '@stagegrid/shared'
import { and, asc, eq, inArray, isNotNull, isNull, like, or } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'

import type { DbOrTx } from '../db/client'
import { projectMembers, projects, stages } from '../db/schema'
import { slugify, uniqueSlug } from '../domain/slug'
import { conflict } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireAdmin, requireProjectRole } from './access'
import { audit } from './audit'
import { requireActor, type ServiceContext, withTx } from './context'
import { statsForCells } from './project-stats'
import { nextReleases } from './releases.service'
import { getInstanceSettings } from './settings.service'
import { loadCells, loadCellsFor, loadStages } from './structure'

export function toProjectDto(
  p: ProjectRow,
  role: ProjectRole,
  stats: ProjectDto['stats'],
  nextRelease: ProjectDto['nextRelease'] = null,
): ProjectDto {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    timezone: p.timezone,
    staleDays: p.staleDays,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    role,
    stats,
    nextRelease,
    defaultReleasePhases: p.defaultReleasePhases,
  }
}

async function takenSlugs(db: DbOrTx, base: string, exceptId?: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(or(eq(projects.slug, base), like(projects.slug, `${base.slice(0, 44)}-%`)))
  return new Set(rows.filter((r) => r.id !== exceptId).map((r) => r.slug))
}

export async function listProjects(
  ctx: ServiceContext,
  opts: { archived?: boolean } = {},
): Promise<ProjectDto[]> {
  const actor = requireActor(ctx)
  const archivedFilter = opts.archived
    ? isNotNull(projects.archivedAt)
    : isNull(projects.archivedAt)
  let rows: { project: ProjectRow; role: ProjectRole }[]
  if (actor.isAdmin) {
    const ps = await ctx.db
      .select()
      .from(projects)
      .where(archivedFilter)
      .orderBy(asc(projects.name))
    rows = ps.map((project) => ({ project, role: 'owner' as const }))
  } else {
    const ps = await ctx.db
      .select({ project: projects, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, actor.userId), archivedFilter))
      .orderBy(asc(projects.name))
    rows = ps
  }
  const ids = rows.map((r) => r.project.id)
  const [allCells, next] = await Promise.all([loadCellsFor(ctx.db, ids), nextReleases(ctx.db, ids)])
  const now = ctx.now()
  return rows.map(({ project, role }) =>
    toProjectDto(
      project,
      role,
      statsForCells(
        allCells.filter((c) => c.projectId === project.id),
        project,
        now,
      ),
      next.get(project.id) ?? null,
    ),
  )
}

export async function getProject(ctx: ServiceContext, ref: string): Promise<ProjectDto> {
  const { project, role } = await requireProjectRole(ctx, ref, 'viewer')
  const next = await nextReleases(ctx.db, [project.id])
  return toProjectDto(
    project,
    role,
    statsForCells(await loadCells(ctx.db, project.id), project, ctx.now()),
    next.get(project.id) ?? null,
  )
}

export async function createProject(
  ctx: ServiceContext,
  input: CreateProjectInput,
): Promise<ProjectDto> {
  const actor = requireAdmin(ctx)
  let stageNames: string[] = [...DEFAULT_STAGES]
  if (input.copyStagesFrom) {
    const source = await requireProjectRole(ctx, input.copyStagesFrom, 'viewer')
    stageNames = (await loadStages(ctx.db, source.project.id)).map((s) => s.name)
  }
  return withTx(ctx, async (tx, txCtx) => {
    const now = ctx.now()
    const base = input.slug ?? slugify(input.name)
    const taken = await takenSlugs(tx, base)
    if (input.slug && taken.has(input.slug))
      throw conflict('That slug is already used by another project')
    const slug = uniqueSlug(base, taken)
    const timezone = input.timezone ?? (await getInstanceSettings(tx)).timezone
    const [project] = await tx
      .insert(projects)
      .values({
        id: newId(),
        name: input.name,
        slug,
        description: input.description ?? '',
        timezone,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    await tx
      .insert(projectMembers)
      .values({ projectId: project!.id, userId: actor.userId, role: 'owner', createdAt: now })
    const keys = generateNKeysBetween(null, null, stageNames.length)
    if (stageNames.length > 0) {
      await tx.insert(stages).values(
        stageNames.map((name, i) => ({
          id: newId(),
          projectId: project!.id,
          name,
          position: keys[i]!,
          createdAt: now,
        })),
      )
    }
    await audit(tx, txCtx, {
      projectId: project!.id,
      action: 'project.create',
      targetType: 'project',
      targetId: project!.id,
      after: { name: project!.name, slug, stages: stageNames },
    })
    const empty = { all: 0, open: 0, doing: 0, done: 0, percent: 0, rework: 0, stale: 0 }
    return toProjectDto(project!, 'owner', empty)
  })
}

export async function updateProject(
  ctx: ServiceContext,
  ref: string,
  input: UpdateProjectInput,
): Promise<ProjectDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  return withTx(ctx, async (tx, txCtx) => {
    if (input.slug && input.slug !== project.slug) {
      const taken = await takenSlugs(tx, input.slug, project.id)
      if (taken.has(input.slug)) throw conflict('That slug is already used by another project')
    }
    const [updated] = await tx
      .update(projects)
      .set({
        name: input.name ?? project.name,
        slug: input.slug ?? project.slug,
        description: input.description ?? project.description,
        timezone: input.timezone ?? project.timezone,
        staleDays: input.staleDays ?? project.staleDays,
        defaultReleasePhases: input.defaultReleasePhases ?? project.defaultReleasePhases,
        updatedAt: ctx.now(),
      })
      .where(eq(projects.id, project.id))
      .returning()
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'project.update',
      targetType: 'project',
      targetId: project.id,
      before: {
        name: project.name,
        slug: project.slug,
        description: project.description,
        timezone: project.timezone,
        staleDays: project.staleDays,
      },
      after: input,
    })
    await notify(tx, txCtx, project.id, 'project.updated')
    return toProjectDto(
      updated!,
      'owner',
      statsForCells(await loadCells(tx, project.id), updated!, ctx.now()),
    )
  })
}

export async function setProjectArchived(
  ctx: ServiceContext,
  ref: string,
  archived: boolean,
): Promise<ProjectDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner', { allowArchived: true })
  return withTx(ctx, async (tx, txCtx) => {
    const [updated] = await tx
      .update(projects)
      .set({ archivedAt: archived ? ctx.now() : null, updatedAt: ctx.now() })
      .where(eq(projects.id, project.id))
      .returning()
    await audit(tx, txCtx, {
      projectId: project.id,
      action: archived ? 'project.archive' : 'project.unarchive',
      targetType: 'project',
      targetId: project.id,
    })
    await notify(tx, txCtx, project.id, 'project.updated')
    return toProjectDto(
      updated!,
      'owner',
      statsForCells(await loadCells(tx, project.id), updated!, ctx.now()),
    )
  })
}

/** Projects the actor may copy stages from (used by the create dialog). */
export async function projectIdsVisibleTo(ctx: ServiceContext, ids: string[]): Promise<string[]> {
  const actor = requireActor(ctx)
  if (actor.isAdmin || ids.length === 0) return ids
  const rows = await ctx.db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, actor.userId), inArray(projectMembers.projectId, ids)))
  return rows.map((r) => r.id)
}
