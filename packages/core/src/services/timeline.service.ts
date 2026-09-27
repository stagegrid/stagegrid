import {
  type BurnupDto,
  type TimelineDto,
  type TimelineLaneDto,
  zonedDate,
} from '@stagegrid/shared'
import { and, inArray, isNull } from 'drizzle-orm'

import { cellEvents, cellRounds } from '../db/schema'
import { computeBurnup } from '../domain/burnup'
import { orderDepthFirst } from '../domain/tree'
import { requireProjectRole } from './access'
import type { ServiceContext } from './context'
import { loadCells, loadItems, loadStages } from './structure'

/** Gantt data (spec 03 §9): per item, one lane per stage that has planned dates or work rounds. */
export async function getTimeline(ctx: ServiceContext, ref: string): Promise<TimelineDto> {
  const { project, role } = await requireProjectRole(ctx, ref, 'viewer')
  const [stageRows, itemRows, cellRows] = await Promise.all([
    loadStages(ctx.db, project.id),
    loadItems(ctx.db, project.id),
    loadCells(ctx.db, project.id),
  ])
  const today = zonedDate(ctx.now(), project.timezone)
  const rounds = cellRows.length
    ? await ctx.db
        .select()
        .from(cellRounds)
        .where(
          inArray(
            cellRounds.cellId,
            cellRows.map((c) => c.id),
          ),
        )
    : []
  const roundsByCell = new Map<string, typeof rounds>()
  for (const r of rounds) roundsByCell.set(r.cellId, [...(roundsByCell.get(r.cellId) ?? []), r])
  const stageOrder = new Map(stageRows.map((s, i) => [s.id, i]))

  let from = today
  let to = today
  const widen = (d: string | null) => {
    if (!d) return
    if (d < from) from = d
    if (d > to) to = d
  }
  const lanesByItem = new Map<string, TimelineLaneDto[]>()
  for (const c of cellRows) {
    const rs = (roundsByCell.get(c.id) ?? []).sort((a, b) => a.roundNo - b.roundNo)
    if (!c.plannedStart && !c.plannedEnd && rs.length === 0) continue
    widen(c.plannedStart)
    widen(c.plannedEnd)
    for (const r of rs) {
      widen(zonedDate(r.startedAt, project.timezone))
      if (r.endedAt) widen(zonedDate(r.endedAt, project.timezone))
    }
    const lane: TimelineLaneDto = {
      cellId: c.id,
      stageId: c.stageId,
      status: c.status,
      plannedStart: c.plannedStart,
      plannedEnd: c.plannedEnd,
      overdue:
        c.plannedEnd !== null && c.plannedEnd < today && c.status !== 'done' && c.status !== 'skip',
      rounds: rs.map((r) => ({
        roundNo: r.roundNo,
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
        outcome: r.outcome,
      })),
    }
    lanesByItem.set(c.itemId, [...(lanesByItem.get(c.itemId) ?? []), lane])
  }
  return {
    project: { slug: project.slug, name: project.name, timezone: project.timezone, role },
    today,
    from,
    to,
    stages: stageRows.map((s) => ({ id: s.id, name: s.name })),
    items: orderDepthFirst(itemRows).map((i) => ({
      id: i.id,
      parentId: i.parentId,
      name: i.name,
      depth: i.depth,
      lanes: (lanesByItem.get(i.id) ?? []).sort(
        (a, b) => stageOrder.get(a.stageId)! - stageOrder.get(b.stageId)!,
      ),
    })),
  }
}

export async function getBurnup(ctx: ServiceContext, ref: string): Promise<BurnupDto> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const cellRows = await loadCells(ctx.db, project.id)
  const events = cellRows.length
    ? await ctx.db
        .select()
        .from(cellEvents)
        .where(
          and(
            inArray(
              cellEvents.cellId,
              cellRows.map((c) => c.id),
            ),
            isNull(cellEvents.deletedAt),
          ),
        )
    : []
  const byCell = new Map<string, typeof events>()
  for (const e of events) byCell.set(e.cellId, [...(byCell.get(e.cellId) ?? []), e])
  const points = computeBurnup(
    cellRows.map((c) => ({ createdAt: c.createdAt, events: byCell.get(c.id) ?? [] })),
    project.timezone,
    zonedDate(ctx.now(), project.timezone),
  )
  return { points }
}
