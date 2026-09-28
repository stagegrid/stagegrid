import { and, eq, inArray, isNull } from 'drizzle-orm'

import { cellEvents, users } from '../db/schema'
import { computeCellHistory } from '../domain/rounds'
import { orderDepthFirst } from '../domain/tree'
import { requireProjectRole } from './access'
import { loadAssignees, loadCommentsByCell, loadLinksByCell } from './cell-details.service'
import type { ServiceContext } from './context'
import { makeResolver } from './refs'
import { loadCells, loadItems, loadStages } from './structure'

interface TreeNodeOut {
  name: string
  children: TreeNodeOut[]
}

export async function exportJson(ctx: ServiceContext, ref: string) {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const [stageRows, itemRows, cellRows] = await Promise.all([
    loadStages(ctx.db, project.id),
    loadItems(ctx.db, project.id),
    loadCells(ctx.db, project.id),
  ])
  const ordered = orderDepthFirst(itemRows)
  const resolver = makeResolver(itemRows, stageRows)
  const nodes = new Map<string, TreeNodeOut>(
    ordered.map((i) => [i.id, { name: i.name, children: [] }]),
  )
  const roots: TreeNodeOut[] = []
  for (const i of ordered) {
    const parent = i.parentId ? nodes.get(i.parentId) : undefined
    ;(parent ? parent.children : roots).push(nodes.get(i.id)!)
  }
  const events = cellRows.length
    ? await ctx.db
        .select({ e: cellEvents, actorName: users.name })
        .from(cellEvents)
        .leftJoin(users, eq(users.id, cellEvents.actorUserId))
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
  const eventsByCell = new Map<string, typeof events>()
  for (const e of events) eventsByCell.set(e.e.cellId, [...(eventsByCell.get(e.e.cellId) ?? []), e])
  const cellIds = cellRows.map((c) => c.id)
  const [assignees, commentsByCell, linksByCell] = await Promise.all([
    loadAssignees(ctx.db, cellIds),
    loadCommentsByCell(ctx.db, cellIds),
    loadLinksByCell(ctx.db, cellIds),
  ])
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]))
  const order = new Map(ordered.map((i, n) => [i.id, n]))
  const stageOrder = new Map(stageRows.map((s, n) => [s.id, n]))
  return {
    version: 1,
    exportedAt: ctx.now().toISOString(),
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description,
      timezone: project.timezone,
      staleDays: project.staleDays,
    },
    stages: stageRows.map((s) => s.name),
    items: roots,
    cells: [...cellRows]
      .sort(
        (a, b) =>
          order.get(a.itemId)! - order.get(b.itemId)! ||
          stageOrder.get(a.stageId)! - stageOrder.get(b.stageId)!,
      )
      .map((c) => {
        const evs = eventsByCell.get(c.id) ?? []
        const history = computeCellHistory(evs.map((x) => x.e))
        const fromById = new Map(history.transitions.map((t) => [t.eventId, t.fromStatus]))
        return {
          itemPath: resolver.index.pathOf(c.itemId),
          stage: stageName.get(c.stageId)!,
          status: c.status,
          rework: c.reworkCount,
          plannedStart: c.plannedStart,
          plannedEnd: c.plannedEnd,
          assignees: (assignees.get(c.id) ?? []).map((a) => a.name),
          comments: (commentsByCell.get(c.id) ?? []).map((x) => ({
            by: x.author.name,
            at: x.createdAt,
            body: x.body,
          })),
          links: (linksByCell.get(c.id) ?? []).map((l) => ({
            title: l.title,
            url: l.url,
            kind: l.kind,
          })),
          events: evs
            .map(({ e, actorName }) => ({
              from: fromById.get(e.id) ?? 'todo',
              to: e.toStatus,
              happenedAt: e.happenedAt.toISOString(),
              recordedAt: e.recordedAt.toISOString(),
              actor: actorName ?? 'System',
              via: e.via,
              reason: e.reason,
            }))
            .sort((a, b) => (a.happenedAt < b.happenedAt ? -1 : 1)),
        }
      }),
  }
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** One row per item: path, then the status name for each active stage. UTF-8 with BOM for Excel. */
export async function exportCsv(ctx: ServiceContext, ref: string): Promise<string> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const [stageRows, itemRows, cellRows] = await Promise.all([
    loadStages(ctx.db, project.id),
    loadItems(ctx.db, project.id),
    loadCells(ctx.db, project.id),
  ])
  const resolver = makeResolver(itemRows, stageRows)
  const status = new Map(cellRows.map((c) => [`${c.itemId}:${c.stageId}`, c.status]))
  const lines = [['path', ...stageRows.map((s) => s.name)].map(csvCell).join(',')]
  for (const i of orderDepthFirst(itemRows)) {
    lines.push(
      [resolver.index.pathOf(i.id), ...stageRows.map((s) => status.get(`${i.id}:${s.id}`) ?? '')]
        .map(csvCell)
        .join(','),
    )
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
