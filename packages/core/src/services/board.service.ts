import type {
  AssigneeDto,
  BoardDto,
  CellDetailDto,
  CellStatus,
  StaleReason,
  Stats,
} from '@stagegrid/shared'
import { and, desc, eq, gte, isNull } from 'drizzle-orm'

import {
  auditLog,
  cellAssignees,
  cellEvents,
  cellLinks,
  cellRounds,
  cells,
  comments,
  items,
  stages,
  users,
} from '../db/schema'
import { computeCellHistory } from '../domain/rounds'
import { computeStats } from '../domain/stats'
import { orderDepthFirst } from '../domain/tree'
import { notFound } from '../errors'
import { requireProjectRole } from './access'
import { loadAssignees, loadComments, loadLinks } from './cell-details.service'
import type { ServiceContext } from './context'
import { cellStale } from './project-stats'
import { makeResolver } from './refs'
import { activeReleasesByItem } from './releases.service'
import { toStageDto } from './stages.service'
import { loadCells, loadItems, loadStages } from './structure'

export async function getBoard(ctx: ServiceContext, ref: string): Promise<BoardDto> {
  const { project, role } = await requireProjectRole(ctx, ref, 'viewer')
  const [stageRows, itemRows, cellRows, flags, itemReleases] = await Promise.all([
    loadStages(ctx.db, project.id),
    loadItems(ctx.db, project.id),
    loadCells(ctx.db, project.id),
    loadCellFlags(ctx, project.id),
    activeReleasesByItem(ctx.db, project.id),
  ])
  const now = ctx.now()
  const cellsMap: BoardDto['cells'] = {}
  const statsInput: {
    stageId: string
    status: (typeof cellRows)[number]['status']
    reworkCount: number
    stale: boolean
  }[] = []
  const itemAssignees = new Map<string, Map<string, AssigneeDto>>()
  for (const c of cellRows) {
    const stale = cellStale(c, project, now)
    ;(cellsMap[c.itemId] ??= {})[c.stageId] = {
      id: c.id,
      status: c.status,
      rework: c.reworkCount,
      stale,
      hasComments: flags.withComments.has(c.id),
      hasDocLink: flags.withDocLink.has(c.id),
    }
    statsInput.push({
      stageId: c.stageId,
      status: c.status,
      reworkCount: c.reworkCount,
      stale: stale !== null,
    })
    for (const a of flags.assignees.get(c.id) ?? []) {
      const byKey = itemAssignees.get(c.itemId) ?? new Map<string, AssigneeDto>()
      byKey.set(a.userId ?? `name:${a.name.toLowerCase()}`, a)
      itemAssignees.set(c.itemId, byKey)
    }
  }
  const byStage: Record<string, Stats> = {}
  for (const s of stageRows)
    byStage[s.id] = computeStats(statsInput.filter((x) => x.stageId === s.id))
  return {
    project: {
      id: project.id,
      slug: project.slug,
      name: project.name,
      timezone: project.timezone,
      staleDays: project.staleDays,
      role,
    },
    stages: stageRows.map(toStageDto),
    items: orderDepthFirst(itemRows).map((i) => ({
      id: i.id,
      parentId: i.parentId,
      name: i.name,
      position: i.position,
      depth: i.depth,
      assignees: [...(itemAssignees.get(i.id)?.values() ?? [])],
      releases: itemReleases.get(i.id) ?? [],
    })),
    cells: cellsMap,
    stats: { ...computeStats(statsInput), items: itemRows.length, byStage },
  }
}

/** Which cells have comments / doc links, and every cell's assignees, for one project. */
async function loadCellFlags(ctx: ServiceContext, projectId: string) {
  const inProject = and(eq(items.projectId, projectId), isNull(items.deletedAt))
  const [commentRows, linkRows, assigneeRows] = await Promise.all([
    ctx.db
      .selectDistinct({ cellId: comments.cellId })
      .from(comments)
      .innerJoin(cells, eq(cells.id, comments.cellId))
      .innerJoin(items, eq(items.id, cells.itemId))
      .where(and(inProject, isNull(comments.deletedAt))),
    ctx.db
      .selectDistinct({ cellId: cellLinks.cellId })
      .from(cellLinks)
      .innerJoin(cells, eq(cells.id, cellLinks.cellId))
      .innerJoin(items, eq(items.id, cells.itemId))
      .where(and(inProject, isNull(cellLinks.deletedAt), eq(cellLinks.kind, 'doc'))),
    ctx.db
      .select({
        cellId: cellAssignees.cellId,
        userId: cellAssignees.userId,
        displayName: cellAssignees.displayName,
        userName: users.name,
      })
      .from(cellAssignees)
      .innerJoin(cells, eq(cells.id, cellAssignees.cellId))
      .innerJoin(items, eq(items.id, cells.itemId))
      .leftJoin(users, eq(users.id, cellAssignees.userId))
      .where(inProject),
  ])
  const assignees = new Map<string, AssigneeDto[]>()
  for (const r of assigneeRows) {
    const list = assignees.get(r.cellId) ?? []
    list.push({ userId: r.userId, name: r.userId ? (r.userName ?? 'Unknown') : r.displayName! })
    assignees.set(r.cellId, list)
  }
  return {
    withComments: new Set(commentRows.map((r) => r.cellId)),
    withDocLink: new Set(linkRows.map((r) => r.cellId)),
    assignees,
  }
}

export interface SummaryDto {
  project: { slug: string; name: string }
  stats: Stats & { items: number }
  byStage: { stage: string; stats: Stats }[]
}

export async function getSummary(ctx: ServiceContext, ref: string): Promise<SummaryDto> {
  const board = await getBoard(ctx, ref)
  const { byStage, ...stats } = board.stats
  return {
    project: { slug: board.project.slug, name: board.project.name },
    stats,
    byStage: board.stages.map((s) => ({ stage: s.name, stats: byStage[s.id]! })),
  }
}

export async function getCellDetail(
  ctx: ServiceContext,
  ref: string,
  cellId: string,
): Promise<CellDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const [row] = await ctx.db
    .select({ cell: cells, item: items, stage: stages })
    .from(cells)
    .innerJoin(items, eq(items.id, cells.itemId))
    .innerJoin(stages, eq(stages.id, cells.stageId))
    .where(and(eq(cells.id, cellId), eq(items.projectId, project.id)))
  if (!row) throw notFound('Cell not found')
  const events = await ctx.db
    .select({ event: cellEvents, actorName: users.name })
    .from(cellEvents)
    .leftJoin(users, eq(users.id, cellEvents.actorUserId))
    .where(and(eq(cellEvents.cellId, cellId), isNull(cellEvents.deletedAt)))
  const history = computeCellHistory(events.map((e) => e.event))
  const fromById = new Map(history.transitions.map((t) => [t.eventId, t.fromStatus]))
  const [rounds, itemsAll, assignees, commentList, links] = await Promise.all([
    ctx.db.select().from(cellRounds).where(eq(cellRounds.cellId, cellId)),
    loadItems(ctx.db, project.id),
    loadAssignees(ctx.db, [cellId]),
    loadComments(ctx.db, cellId),
    loadLinks(ctx.db, cellId),
  ])
  return {
    id: row.cell.id,
    itemId: row.item.id,
    itemPath: makeResolver(itemsAll, []).index.pathOf(row.item.id),
    stageId: row.stage.id,
    stageName: row.stage.name,
    status: row.cell.status,
    rework: row.cell.reworkCount,
    stale: cellStale(row.cell, project, ctx.now()),
    plannedStart: row.cell.plannedStart,
    plannedEnd: row.cell.plannedEnd,
    events: events
      .map(({ event: e, actorName }) => ({
        id: e.id,
        fromStatus: fromById.get(e.id) ?? 'todo',
        toStatus: e.toStatus,
        happenedAt: e.happenedAt.toISOString(),
        recordedAt: e.recordedAt.toISOString(),
        actor: { userId: e.actorUserId, name: actorName ?? 'System', via: e.via },
        reason: e.reason,
      }))
      .sort((a, b) =>
        a.happenedAt < b.happenedAt
          ? 1
          : a.happenedAt > b.happenedAt
            ? -1
            : a.recordedAt < b.recordedAt
              ? 1
              : -1,
      ),
    rounds: rounds
      .sort((a, b) => a.roundNo - b.roundNo)
      .map((r) => ({
        roundNo: r.roundNo,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
        outcome: r.outcome,
      })),
    assignees: assignees.get(cellId) ?? [],
    comments: commentList,
    links,
  }
}

export interface ActivityDto {
  id: string
  action: string
  targetType: string
  targetId: string | null
  actor: { userId: string | null; name: string; via: string }
  before: unknown
  after: unknown
  createdAt: string
}

export async function getActivity(
  ctx: ServiceContext,
  ref: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<ActivityDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const since = opts.since ?? new Date(ctx.now().getTime() - 7 * 86_400_000)
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200)
  const rows = await ctx.db
    .select({ log: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(eq(auditLog.projectId, project.id), gte(auditLog.createdAt, since)))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit)
  return rows.map(({ log, actorName }) => ({
    id: log.id,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    actor: { userId: log.actorUserId, name: actorName ?? 'System', via: log.via },
    before: log.before,
    after: log.after,
    createdAt: log.createdAt.toISOString(),
  }))
}

/** Cell detail addressed by item path/id and stage name/id (used by MCP). */
export async function getCellByRefs(
  ctx: ServiceContext,
  ref: string,
  itemRef: string,
  stageRef: string,
): Promise<CellDetailDto> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const [itemRows, stageRows] = await Promise.all([
    loadItems(ctx.db, project.id),
    loadStages(ctx.db, project.id),
  ])
  const resolver = makeResolver(itemRows, stageRows)
  const item = resolver.item(itemRef)
  const stage = resolver.stage(stageRef)
  const [cell] = await ctx.db
    .select({ id: cells.id })
    .from(cells)
    .where(and(eq(cells.itemId, item.id), eq(cells.stageId, stage.id)))
  if (!cell) throw notFound('Cell not found')
  return getCellDetail(ctx, project.id, cell.id)
}

export interface StaleCellDto {
  item: string
  stage: string
  status: CellStatus
  reason: StaleReason
  since: string | null
  plannedEnd: string | null
}

export async function listStaleCells(ctx: ServiceContext, ref: string): Promise<StaleCellDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const [itemRows, stageRows, cellRows] = await Promise.all([
    loadItems(ctx.db, project.id),
    loadStages(ctx.db, project.id),
    loadCells(ctx.db, project.id),
  ])
  const resolver = makeResolver(itemRows, stageRows)
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]))
  const order = new Map(orderDepthFirst(itemRows).map((i, n) => [i.id, n]))
  const stageOrder = new Map(stageRows.map((s, n) => [s.id, n]))
  const now = ctx.now()
  return cellRows
    .map((c) => ({ c, reason: cellStale(c, project, now) }))
    .filter((x): x is { c: (typeof cellRows)[number]; reason: StaleReason } => x.reason !== null)
    .sort(
      (a, b) =>
        order.get(a.c.itemId)! - order.get(b.c.itemId)! ||
        stageOrder.get(a.c.stageId)! - stageOrder.get(b.c.stageId)!,
    )
    .map(({ c, reason }) => ({
      item: resolver.index.pathOf(c.itemId),
      stage: stageName.get(c.stageId)!,
      status: c.status,
      reason,
      since: c.statusChangedAt?.toISOString() ?? null,
      plannedEnd: c.plannedEnd,
    }))
}
