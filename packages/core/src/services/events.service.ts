import { and, eq, isNull } from 'drizzle-orm'

import { cellEvents, cells, items, stages } from '../db/schema'
import { invalid, notFound } from '../errors'
import { notify } from '../realtime/notify'
import { requireProjectRole } from './access'
import { audit } from './audit'
import { loadEvents, recomputeCell } from './changes.service'
import type { ServiceContext } from './context'
import { withTx } from './context'
import { cellStale } from './project-stats'
import { makeResolver } from './refs'
import { loadItems } from './structure'

const FUTURE_TOLERANCE_MS = 5 * 60_000

/**
 * Corrects history (spec 02 §4): move an event's happenedAt or delete it (soft). The cell's status,
 * rework, and rounds are recomputed; the old values go to the audit log.
 */
export async function editEvent(
  ctx: ServiceContext,
  ref: string,
  eventId: string,
  input: { happenedAt?: string; delete?: boolean },
): Promise<{ cellId: string; status: string }> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  if (!input.delete && !input.happenedAt) throw invalid('Give happenedAt or delete: true')
  return withTx(ctx, async (tx, txCtx) => {
    const [row] = await tx
      .select({ e: cellEvents, cell: cells, stageName: stages.name })
      .from(cellEvents)
      .innerJoin(cells, eq(cells.id, cellEvents.cellId))
      .innerJoin(items, eq(items.id, cells.itemId))
      .innerJoin(stages, eq(stages.id, cells.stageId))
      .where(
        and(
          eq(cellEvents.id, eventId),
          eq(items.projectId, project.id),
          isNull(cellEvents.deletedAt),
        ),
      )
    if (!row) throw notFound('Event not found')
    const now = ctx.now()
    if (input.delete) {
      await tx
        .update(cellEvents)
        .set({ deletedAt: now, deletedBy: ctx.actor!.userId })
        .where(eq(cellEvents.id, eventId))
    } else {
      const happenedAt = new Date(input.happenedAt!)
      if (happenedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS)
        throw invalid('happenedAt is in the future')
      await tx.update(cellEvents).set({ happenedAt }).where(eq(cellEvents.id, eventId))
    }
    const events = (await loadEvents(tx, [row.cell.id])).get(row.cell.id) ?? []
    const cell = await recomputeCell(tx, row.cell.id, events, now)
    await audit(tx, txCtx, {
      projectId: project.id,
      action: input.delete ? 'event.delete' : 'event.edit',
      targetType: 'cell_event',
      targetId: eventId,
      before: { happenedAt: row.e.happenedAt.toISOString(), toStatus: row.e.toStatus },
      after: input.delete ? null : { happenedAt: input.happenedAt },
    })
    const itemsAll = await loadItems(tx, project.id)
    await notify(tx, txCtx, project.id, 'cell.updated', {
      cellId: cell.id,
      itemId: cell.itemId,
      stageId: cell.stageId,
      status: cell.status,
      fromStatus: row.cell.status,
      rework: cell.reworkCount,
      stale: cellStale(cell, project, now),
      itemPath: makeResolver(itemsAll, []).index.pathOf(cell.itemId),
      stageName: row.stageName,
    })
    return { cellId: cell.id, status: cell.status }
  })
}
