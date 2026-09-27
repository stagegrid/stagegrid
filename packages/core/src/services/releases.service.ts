import {
  type AddReleaseItemsInput,
  type CreateReleaseInput,
  type ReleaseDetailDto,
  type ReleasePhaseDto,
  type ReleasePhaseInput,
  type ReleaseScopeItemDto,
  type ReleaseSnapshot,
  type ReleaseSummaryDto,
  type UpdateReleaseInput,
  zonedDate,
} from '@stagegrid/shared'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'

import type { DbOrTx } from '../db/client'
import {
  cells,
  items as itemsTable,
  releaseCells,
  releaseItems,
  releasePhases,
  releases,
} from '../db/schema'
import { displayStatus, releaseRisks } from '../domain/release-risk'
import { computeStats } from '../domain/stats'
import { byPosition, descendantIds, orderDepthFirst } from '../domain/tree'
import { AppError, conflict, invalid, notFound } from '../errors'
import { isUuid, newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireProjectRole } from './access'
import { audit } from './audit'
import { applyChanges } from './changes.service'
import { type ServiceContext, withTx } from './context'
import { cellStale } from './project-stats'
import { makeResolver } from './refs'
import { type CellRow, type ItemRow, loadCells, loadItems, loadStages } from './structure'

type ReleaseRow = typeof releases.$inferSelect
type ReleaseItemRow = typeof releaseItems.$inferSelect

class DryRunRollback extends Error {
  constructor(readonly result: unknown) {
    super('dry run')
  }
}

async function findRelease(db: DbOrTx, projectId: string, ref: string): Promise<ReleaseRow> {
  const byName = sql`lower(${releases.name}) = ${ref.trim().toLowerCase()}`
  const [row] = await db
    .select()
    .from(releases)
    .where(
      and(
        eq(releases.projectId, projectId),
        isNull(releases.deletedAt),
        isUuid(ref) ? eq(releases.id, ref) : byName,
      ),
    )
  if (!row) throw notFound(`No release matches "${ref}"`)
  return row
}

async function loadPhases(
  db: DbOrTx,
  releaseIds: string[],
): Promise<Map<string, ReleasePhaseDto[]>> {
  const map = new Map<string, ReleasePhaseDto[]>()
  if (releaseIds.length === 0) return map
  const rows = await db
    .select()
    .from(releasePhases)
    .where(inArray(releasePhases.releaseId, releaseIds))
  for (const r of rows.sort(byPosition)) {
    const list = map.get(r.releaseId) ?? []
    list.push({
      id: r.id,
      name: r.name,
      plannedStart: r.plannedStart,
      plannedEnd: r.plannedEnd,
      freeze: r.freeze,
    })
    map.set(r.releaseId, list)
  }
  return map
}

async function writePhases(
  db: DbOrTx,
  releaseId: string,
  phases: ReleasePhaseInput[],
): Promise<void> {
  for (const p of phases) {
    if (p.plannedStart && p.plannedEnd && p.plannedStart > p.plannedEnd) {
      throw invalid(`Phase "${p.name}" starts after it ends`)
    }
  }
  await db.delete(releasePhases).where(eq(releasePhases.releaseId, releaseId))
  if (phases.length === 0) return
  const keys = generateNKeysBetween(null, null, phases.length)
  await db.insert(releasePhases).values(
    phases.map((p, i) => ({
      id: p.id ?? newId(),
      releaseId,
      name: p.name,
      plannedStart: p.plannedStart ?? null,
      plannedEnd: p.plannedEnd ?? null,
      freeze: p.freeze ?? false,
      position: keys[i]!,
    })),
  )
}

interface ProjectData {
  items: ItemRow[]
  cellsById: Map<string, CellRow>
  stageName: Map<string, string>
  stageOrder: Map<string, number>
  resolver: ReturnType<typeof makeResolver>
  stages: { id: string; name: string }[]
}

async function projectData(db: DbOrTx, projectId: string): Promise<ProjectData> {
  const [items, stages, cellRows] = await Promise.all([
    loadItems(db, projectId),
    loadStages(db, projectId),
    loadCells(db, projectId),
  ])
  return {
    items,
    cellsById: new Map(cellRows.map((c) => [c.id, c])),
    stageName: new Map(stages.map((s) => [s.id, s.name])),
    stageOrder: new Map(stages.map((s, i) => [s.id, i])),
    resolver: makeResolver(items, stages),
    stages: stages.map((s) => ({ id: s.id, name: s.name })),
  }
}

/** Live scope cells (item not deleted, stage active) per release. */
async function scopeCellIds(db: DbOrTx, releaseIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  if (releaseIds.length === 0) return map
  const rows = await db
    .select()
    .from(releaseCells)
    .where(inArray(releaseCells.releaseId, releaseIds))
  for (const r of rows) map.set(r.releaseId, [...(map.get(r.releaseId) ?? []), r.cellId])
  return map
}

function summarize(
  release: ReleaseRow,
  project: ProjectRow,
  data: ProjectData,
  cellIds: string[],
  phases: ReleasePhaseDto[],
  kinds: ReleaseItemRow[],
  now: Date,
): ReleaseSummaryDto & { risks: ReturnType<typeof releaseRisks>; today: string } {
  const today = zonedDate(now, project.timezone)
  const scope = cellIds.map((id) => data.cellsById.get(id)).filter((c): c is CellRow => !!c)
  const stats = computeStats(
    scope.map((c) => ({
      status: c.status,
      reworkCount: c.reworkCount,
      stale: cellStale(c, project, now) !== null,
    })),
  )
  const risks =
    release.status === 'active'
      ? releaseRisks({
          targetDate: release.targetDate,
          phases,
          today,
          cells: scope
            .sort((a, b) => data.stageOrder.get(a.stageId)! - data.stageOrder.get(b.stageId)!)
            .map((c) => ({
              cellId: c.id,
              item: data.resolver.index.pathOf(c.itemId),
              stage: data.stageName.get(c.stageId)!,
              status: c.status,
              plannedEnd: c.plannedEnd,
            })),
        })
      : []
  const snapshot = release.snapshot as ReleaseSnapshot | null
  return {
    id: release.id,
    name: release.name,
    targetDate: release.targetDate,
    status: release.status,
    displayStatus: displayStatus(release.status, risks.length, scope),
    stats: release.status === 'released' && snapshot ? snapshot.stats : stats,
    riskCount: risks.length,
    itemCount: {
      new: kinds.filter((k) => k.kind === 'new').length,
      change: kinds.filter((k) => k.kind === 'change').length,
    },
    releasedAt: release.releasedAt?.toISOString() ?? null,
    risks,
    today,
  }
}

async function itemKinds(db: DbOrTx, releaseIds: string[]): Promise<Map<string, ReleaseItemRow[]>> {
  const map = new Map<string, ReleaseItemRow[]>()
  if (releaseIds.length === 0) return map
  const rows = await db
    .select()
    .from(releaseItems)
    .where(inArray(releaseItems.releaseId, releaseIds))
  for (const r of rows) map.set(r.releaseId, [...(map.get(r.releaseId) ?? []), r])
  return map
}

const STATUS_ORDER = { active: 0, released: 1, cancelled: 2 } as const

export async function listReleases(
  ctx: ServiceContext,
  ref: string,
  opts: { status?: 'active' | 'released' | 'cancelled' } = {},
): Promise<ReleaseSummaryDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const rows = await ctx.db
    .select()
    .from(releases)
    .where(
      and(
        eq(releases.projectId, project.id),
        isNull(releases.deletedAt),
        opts.status ? eq(releases.status, opts.status) : undefined,
      ),
    )
  const ids = rows.map((r) => r.id)
  const [data, phases, scope, kinds] = await Promise.all([
    projectData(ctx.db, project.id),
    loadPhases(ctx.db, ids),
    scopeCellIds(ctx.db, ids),
    itemKinds(ctx.db, ids),
  ])
  const now = ctx.now()
  return rows
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.status === 'active'
          ? a.targetDate.localeCompare(b.targetDate)
          : b.targetDate.localeCompare(a.targetDate)),
    )
    .map((r) => {
      const {
        risks: _risks,
        today: _today,
        ...summary
      } = summarize(
        r,
        project,
        data,
        scope.get(r.id) ?? [],
        phases.get(r.id) ?? [],
        kinds.get(r.id) ?? [],
        now,
      )
      return summary
    })
}

export async function getRelease(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
): Promise<ReleaseDetailDto> {
  const { project, role } = await requireProjectRole(ctx, ref, 'viewer')
  const release = await findRelease(ctx.db, project.id, releaseRef)
  const [data, phases, scope, kinds] = await Promise.all([
    projectData(ctx.db, project.id),
    loadPhases(ctx.db, [release.id]),
    scopeCellIds(ctx.db, [release.id]),
    itemKinds(ctx.db, [release.id]),
  ])
  const cellIds = scope.get(release.id) ?? []
  const kindRows = kinds.get(release.id) ?? []
  const summary = summarize(
    release,
    project,
    data,
    cellIds,
    phases.get(release.id) ?? [],
    kindRows,
    ctx.now(),
  )

  // Scope tree: items in the release plus their ancestors (as context), board order.
  const byItem = new Map(kindRows.map((k) => [k.itemId, k]))
  const parent = new Map(data.items.map((i) => [i.id, i.parentId]))
  const shown = new Set<string>()
  for (const k of kindRows) {
    for (let id: string | null | undefined = k.itemId; id && !shown.has(id); id = parent.get(id))
      shown.add(id)
  }
  const cellsByItem = new Map<string, ReleaseScopeItemDto['cells']>()
  const now = ctx.now()
  for (const id of cellIds) {
    const c = data.cellsById.get(id)
    if (!c) continue
    const m = cellsByItem.get(c.itemId) ?? {}
    m[c.stageId] = { cellId: c.id, status: c.status, stale: cellStale(c, project, now) }
    cellsByItem.set(c.itemId, m)
  }
  const scopeItems: ReleaseScopeItemDto[] = orderDepthFirst(
    data.items.filter((i) => shown.has(i.id)),
  ).map((i) => ({
    id: i.id,
    parentId: i.parentId,
    name: i.name,
    path: data.resolver.index.pathOf(i.id),
    depth: i.depth,
    kind: byItem.get(i.id)?.kind ?? null,
    note: byItem.get(i.id)?.note ?? null,
    cells: cellsByItem.get(i.id) ?? {},
  }))
  const { risks, today, ...rest } = summary
  return {
    ...rest,
    description: release.description,
    project: { slug: project.slug, name: project.name, timezone: project.timezone, role },
    today,
    phases: phases.get(release.id) ?? [],
    risks,
    stages: data.stages,
    scope: release.status === 'released' ? [] : scopeItems,
    snapshot: (release.snapshot as ReleaseSnapshot | null) ?? null,
  }
}

export async function createRelease(
  ctx: ServiceContext,
  ref: string,
  input: CreateReleaseInput,
): Promise<ReleaseDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  const id = await withTx(ctx, async (tx, txCtx) => {
    const [dupe] = await tx
      .select({ id: releases.id })
      .from(releases)
      .where(
        and(
          eq(releases.projectId, project.id),
          isNull(releases.deletedAt),
          sql`lower(${releases.name}) = ${input.name.toLowerCase()}`,
        ),
      )
    if (dupe) throw conflict('A release with this name already exists')
    const now = ctx.now()
    const id = newId()
    await tx.insert(releases).values({
      id,
      projectId: project.id,
      name: input.name,
      description: input.description ?? '',
      targetDate: input.targetDate,
      createdBy: ctx.actor!.userId,
      createdAt: now,
      updatedAt: now,
    })
    await writePhases(
      tx,
      id,
      input.phases ?? project.defaultReleasePhases.map((p) => ({ name: p.name, freeze: p.freeze })),
    )
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'release.create',
      targetType: 'release',
      targetId: id,
      after: { name: input.name, targetDate: input.targetDate },
    })
    await notify(tx, txCtx, project.id, 'release.updated', { releaseId: id })
    return id
  })
  return getRelease(ctx, project.id, id)
}

function requireActive(r: ReleaseRow): void {
  if (r.status !== 'active')
    throw conflict(`Release "${r.name}" is ${r.status}; its scope and schedule can't change`)
}

export async function updateRelease(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
  input: UpdateReleaseInput,
): Promise<ReleaseDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  const id = await withTx(ctx, async (tx, txCtx) => {
    const r = await findRelease(tx, project.id, releaseRef)
    if (input.targetDate && input.targetDate !== r.targetDate) requireActive(r)
    if (input.name && input.name.toLowerCase() !== r.name.toLowerCase()) {
      const [dupe] = await tx
        .select({ id: releases.id })
        .from(releases)
        .where(
          and(
            eq(releases.projectId, project.id),
            isNull(releases.deletedAt),
            ne(releases.id, r.id),
            sql`lower(${releases.name}) = ${input.name.toLowerCase()}`,
          ),
        )
      if (dupe) throw conflict('A release with this name already exists')
    }
    await tx
      .update(releases)
      .set({
        name: input.name ?? r.name,
        description: input.description ?? r.description,
        targetDate: input.targetDate ?? r.targetDate,
        updatedAt: ctx.now(),
      })
      .where(eq(releases.id, r.id))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'release.update',
      targetType: 'release',
      targetId: r.id,
      before: { name: r.name, targetDate: r.targetDate },
      after: input,
    })
    await notify(tx, txCtx, project.id, 'release.updated', { releaseId: r.id })
    return r.id
  })
  return getRelease(ctx, project.id, id)
}

export async function setReleasePhases(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
  phases: ReleasePhaseInput[],
): Promise<ReleaseDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  const id = await withTx(ctx, async (tx, txCtx) => {
    const r = await findRelease(tx, project.id, releaseRef)
    requireActive(r)
    await writePhases(tx, r.id, phases)
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'release.phases',
      targetType: 'release',
      targetId: r.id,
      after: { phases },
    })
    await notify(tx, txCtx, project.id, 'release.updated', { releaseId: r.id })
    return r.id
  })
  return getRelease(ctx, project.id, id)
}

export interface AddReleaseItemsResult {
  dryRun: boolean
  added: { item: string; kind: 'new' | 'change'; cells: number }[]
  reopened: { item: string; stage: string }[]
}

/**
 * Adds items to a release (spec 07 §3). "new" puts every active stage's cell in scope; "change"
 * puts only the given stages and reopens those that are done (event → todo, reason "Release <name>").
 */
export async function addReleaseItems(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
  input: AddReleaseItemsInput,
): Promise<AddReleaseItemsResult> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  try {
    return await withTx(ctx, async (tx, txCtx) => {
      const r = await findRelease(tx, project.id, releaseRef)
      requireActive(r)
      const data = await projectData(tx, project.id)
      const existing = new Set(
        (
          await tx
            .select({ itemId: releaseItems.itemId })
            .from(releaseItems)
            .where(eq(releaseItems.releaseId, r.id))
        ).map((x) => x.itemId),
      )
      const cellByKey = new Map(
        [...data.cellsById.values()].map((c) => [`${c.itemId}:${c.stageId}`, c]),
      )
      const result: AddReleaseItemsResult = { dryRun: input.dryRun, added: [], reopened: [] }
      const reopen: { item: string; stage: string }[] = []
      const now = ctx.now()

      for (const entry of input.items) {
        const root = data.resolver.item(entry.item)
        const targets = entry.includeDescendants
          ? [root.id, ...descendantIds(data.items, root.id)]
          : [root.id]
        const stageIds =
          entry.kind === 'new'
            ? data.stages.map((s) => s.id)
            : entry.stages!.map((s) => data.resolver.stage(s).id)
        for (const itemId of targets) {
          const path = data.resolver.index.pathOf(itemId)
          if (existing.has(itemId))
            throw conflict(
              `"${path}" is already in release "${r.name}". Remove it first to change it.`,
            )
          existing.add(itemId)
          await tx.insert(releaseItems).values({
            id: newId(),
            releaseId: r.id,
            itemId,
            kind: entry.kind,
            note: entry.note ?? null,
            addedBy: ctx.actor!.userId,
            createdAt: now,
          })
          const scope = stageIds
            .map((sid) => cellByKey.get(`${itemId}:${sid}`))
            .filter((c): c is CellRow => !!c)
          if (scope.length)
            await tx
              .insert(releaseCells)
              .values(scope.map((c) => ({ releaseId: r.id, cellId: c.id, createdAt: now })))
              .onConflictDoNothing()
          if (entry.kind === 'change') {
            for (const c of scope)
              if (c.status === 'done') reopen.push({ item: c.itemId, stage: c.stageId })
          }
          result.added.push({ item: path, kind: entry.kind, cells: scope.length })
        }
      }
      if (reopen.length) {
        await applyChanges(txCtx, project.id, {
          dryRun: false,
          changes: reopen.map((x) => ({
            item: x.item,
            stage: x.stage,
            status: 'todo',
            reason: `Release ${r.name}`,
          })),
        })
        result.reopened = reopen.map((x) => ({
          item: data.resolver.index.pathOf(x.item),
          stage: data.stageName.get(x.stage)!,
        }))
      }
      await audit(tx, txCtx, {
        projectId: project.id,
        action: 'release.items_add',
        targetType: 'release',
        targetId: r.id,
        after: { added: result.added, reopened: result.reopened },
      })
      await notify(tx, txCtx, project.id, 'release.updated', { releaseId: r.id })
      if (input.dryRun) throw new DryRunRollback(result)
      return result
    })
  } catch (e) {
    if (e instanceof DryRunRollback) return e.result as AddReleaseItemsResult
    throw e
  }
}

/** Removes items (and their scope cells). Reopened cells are not reverted — their history stays. */
export async function removeReleaseItems(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
  itemRefs: string[],
): Promise<{ removed: string[] }> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const r = await findRelease(tx, project.id, releaseRef)
    requireActive(r)
    const data = await projectData(tx, project.id)
    const removed: string[] = []
    for (const itemRef of itemRefs) {
      const item = data.resolver.item(itemRef)
      const [row] = await tx
        .delete(releaseItems)
        .where(and(eq(releaseItems.releaseId, r.id), eq(releaseItems.itemId, item.id)))
        .returning()
      if (!row)
        throw notFound(`"${data.resolver.index.pathOf(item.id)}" is not in release "${r.name}"`)
      const itemCells = await tx
        .select({ id: cells.id })
        .from(cells)
        .where(eq(cells.itemId, item.id))
      if (itemCells.length) {
        await tx.delete(releaseCells).where(
          and(
            eq(releaseCells.releaseId, r.id),
            inArray(
              releaseCells.cellId,
              itemCells.map((c) => c.id),
            ),
          ),
        )
      }
      removed.push(data.resolver.index.pathOf(item.id))
    }
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'release.items_remove',
      targetType: 'release',
      targetId: r.id,
      before: { removed },
    })
    await notify(tx, txCtx, project.id, 'release.updated', { releaseId: r.id })
    return { removed }
  })
}

export async function updateReleaseItemNote(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
  itemId: string,
  note: string | null,
): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  await withTx(ctx, async (tx, txCtx) => {
    const r = await findRelease(tx, project.id, releaseRef)
    requireActive(r)
    const [row] = await tx
      .update(releaseItems)
      .set({ note: note || null })
      .where(and(eq(releaseItems.releaseId, r.id), eq(releaseItems.itemId, itemId)))
      .returning()
    if (!row) throw notFound('Item is not in this release')
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'release.update',
      targetType: 'release',
      targetId: r.id,
      after: { itemId, note },
    })
    await notify(tx, txCtx, project.id, 'release.updated', { releaseId: r.id })
  })
}

/** Owner only. Needs `force` when scope cells aren't done. Stores a snapshot and freezes the scope. */
export async function markReleased(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
  opts: { force?: boolean } = {},
): Promise<ReleaseDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  const detail = await getRelease(ctx, project.id, releaseRef)
  if (detail.status !== 'active')
    throw conflict(`Release "${detail.name}" is already ${detail.status}`)
  const open = detail.stats.open
  if (open > 0 && !opts.force) {
    throw new AppError(
      'conflict',
      `${open} cell${open === 1 ? " isn't" : "s aren't"} done. Send force: true to release anyway.`,
      { open },
    )
  }
  await withTx(ctx, async (tx, txCtx) => {
    const now = ctx.now()
    const stageName = new Map(detail.stages.map((s) => [s.id, s.name]))
    const snapshot: ReleaseSnapshot = {
      releasedAt: now.toISOString(),
      targetDate: detail.targetDate,
      phases: detail.phases,
      stats: detail.stats,
      items: detail.scope
        .filter((i) => i.kind !== null)
        .map((i) => ({
          path: i.path,
          kind: i.kind!,
          note: i.note,
          cells: Object.entries(i.cells).map(([sid, c]) => ({
            stage: stageName.get(sid)!,
            status: c.status,
          })),
        })),
    }
    await tx
      .update(releases)
      .set({
        status: 'released',
        releasedAt: now,
        releasedBy: ctx.actor!.userId,
        snapshot,
        updatedAt: now,
      })
      .where(eq(releases.id, detail.id))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'release.release',
      targetType: 'release',
      targetId: detail.id,
      after: { stats: detail.stats, forced: open > 0 },
    })
    await notify(tx, txCtx, project.id, 'release.updated', { releaseId: detail.id })
  })
  return getRelease(ctx, project.id, detail.id)
}

export async function cancelRelease(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  await withTx(ctx, async (tx, txCtx) => {
    const r = await findRelease(tx, project.id, releaseRef)
    requireActive(r)
    await tx
      .update(releases)
      .set({ status: 'cancelled', updatedAt: ctx.now() })
      .where(eq(releases.id, r.id))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'release.cancel',
      targetType: 'release',
      targetId: r.id,
    })
    await notify(tx, txCtx, project.id, 'release.updated', { releaseId: r.id })
  })
}

export async function deleteRelease(
  ctx: ServiceContext,
  ref: string,
  releaseRef: string,
): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  await withTx(ctx, async (tx, txCtx) => {
    const r = await findRelease(tx, project.id, releaseRef)
    await tx.update(releases).set({ deletedAt: ctx.now() }).where(eq(releases.id, r.id))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'release.delete',
      targetType: 'release',
      targetId: r.id,
      before: { name: r.name },
    })
    await notify(tx, txCtx, project.id, 'release.updated', { releaseId: r.id })
  })
}

/** New or restored stage: its cells join every active release where the item is "new". */
export async function addStageCellsToReleases(
  tx: DbOrTx,
  projectId: string,
  stageId: string,
  now: Date,
): Promise<void> {
  const rows = await tx
    .select({ releaseId: releaseItems.releaseId, cellId: cells.id })
    .from(releaseItems)
    .innerJoin(releases, eq(releases.id, releaseItems.releaseId))
    .innerJoin(cells, and(eq(cells.itemId, releaseItems.itemId), eq(cells.stageId, stageId)))
    .where(
      and(
        eq(releases.projectId, projectId),
        eq(releases.status, 'active'),
        isNull(releases.deletedAt),
        eq(releaseItems.kind, 'new'),
      ),
    )
  if (rows.length)
    await tx
      .insert(releaseCells)
      .values(rows.map((r) => ({ ...r, createdAt: now })))
      .onConflictDoNothing()
}

/** Active releases per item, for board row tags. */
export async function activeReleasesByItem(
  db: DbOrTx,
  projectId: string,
): Promise<Map<string, { id: string; name: string }[]>> {
  const rows = await db
    .select({
      itemId: releaseItems.itemId,
      id: releases.id,
      name: releases.name,
      targetDate: releases.targetDate,
    })
    .from(releaseItems)
    .innerJoin(releases, eq(releases.id, releaseItems.releaseId))
    .innerJoin(itemsTable, eq(itemsTable.id, releaseItems.itemId))
    .where(
      and(
        eq(releases.projectId, projectId),
        eq(releases.status, 'active'),
        isNull(releases.deletedAt),
      ),
    )
    .orderBy(asc(releases.targetDate))
  const map = new Map<string, { id: string; name: string }[]>()
  for (const r of rows)
    map.set(r.itemId, [...(map.get(r.itemId) ?? []), { id: r.id, name: r.name }])
  return map
}

/** Nearest active release per project with its percent done (for project cards). */
export async function nextReleases(
  db: DbOrTx,
  projectIds: string[],
): Promise<Map<string, { id: string; name: string; targetDate: string; percent: number }>> {
  const map = new Map<string, { id: string; name: string; targetDate: string; percent: number }>()
  if (projectIds.length === 0) return map
  const rows = await db
    .select()
    .from(releases)
    .where(
      and(
        inArray(releases.projectId, projectIds),
        eq(releases.status, 'active'),
        isNull(releases.deletedAt),
      ),
    )
    .orderBy(asc(releases.targetDate))
  const first = new Map<string, ReleaseRow>()
  for (const r of rows) if (!first.has(r.projectId)) first.set(r.projectId, r)
  const ids = [...first.values()].map((r) => r.id)
  const scope = await scopeCellIds(db, ids)
  const scopeIds = [...scope.values()].flat()
  const allCells = scopeIds.length
    ? await db
        .select({ id: cells.id, status: cells.status })
        .from(cells)
        .where(inArray(cells.id, scopeIds))
    : []
  const status = new Map(allCells.map((c) => [c.id, c.status]))
  for (const [projectId, r] of first) {
    const st = (scope.get(r.id) ?? []).map((id) => status.get(id)).filter((s) => s && s !== 'skip')
    const done = st.filter((s) => s === 'done').length
    map.set(projectId, {
      id: r.id,
      name: r.name,
      targetDate: r.targetDate,
      percent: st.length ? Math.round((done / st.length) * 1000) / 10 : 0,
    })
  }
  return map
}
