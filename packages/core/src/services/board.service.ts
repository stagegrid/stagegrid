import type { BoardDto, CellDetailDto, Stats } from '@stagegrid/shared'
import { and, desc, eq, gte, isNull } from 'drizzle-orm'

import { auditLog, cellEvents, cellRounds, cells, items, stages, users } from '../db/schema'
import { computeCellHistory } from '../domain/rounds'
import { computeStats } from '../domain/stats'
import { orderDepthFirst } from '../domain/tree'
import { notFound } from '../errors'
import { requireProjectRole } from './access'
import type { ServiceContext } from './context'
import { cellStale } from './project-stats'
import { makeResolver } from './refs'
import { toStageDto } from './stages.service'
import { loadCells, loadItems, loadStages } from './structure'

export async function getBoard(ctx: ServiceContext, ref: string): Promise<BoardDto> {
  const { project, role } = await requireProjectRole(ctx, ref, 'viewer')
  const [stageRows, itemRows, cellRows] = await Promise.all([
    loadStages(ctx.db, project.id),
    loadItems(ctx.db, project.id),
    loadCells(ctx.db, project.id),
  ])
  const now = ctx.now()
  const cellsMap: BoardDto['cells'] = {}
  const statsInput: {
    stageId: string
    status: (typeof cellRows)[number]['status']
    reworkCount: number
    stale: boolean
  }[] = []
  for (const c of cellRows) {
    const stale = cellStale(c, project, now)
    ;(cellsMap[c.itemId] ??= {})[c.stageId] = {
      id: c.id,
      status: c.status,
      rework: c.reworkCount,
      stale,
    }
    statsInput.push({
      stageId: c.stageId,
      status: c.status,
      reworkCount: c.reworkCount,
      stale: stale !== null,
    })
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
    })),
    cells: cellsMap,
    stats: { ...computeStats(statsInput), items: itemRows.length, byStage },
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
  const rounds = await ctx.db.select().from(cellRounds).where(eq(cellRounds.cellId, cellId))
  const itemsAll = await loadItems(ctx.db, project.id)
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
