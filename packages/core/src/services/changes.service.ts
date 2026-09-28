import type { CellStatus, ChangeResultDto, ChangesInput, ChangesResultDto } from '@stagegrid/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { Tx } from '../db/client'
import { cellEvents, cellRounds, cells, projectMembers } from '../db/schema'
import { type CellEventLike, computeCellHistory, sortEvents, statusAt } from '../domain/rounds'
import { AppError, invalid } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { requireProjectRole } from './access'
import { audit } from './audit'
import { insertComment, insertLink, replaceAssignees } from './cell-details.service'
import { type ServiceContext, withTx } from './context'
import { cellStale } from './project-stats'
import { makeResolver } from './refs'
import { type CellRow, loadItems, loadStages } from './structure'

const FUTURE_TOLERANCE_MS = 5 * 60_000
const MAX_INDIVIDUAL_EVENTS = 20

class DryRunRollback extends Error {
  constructor(readonly result: ChangesResultDto) {
    super('dry run')
  }
}

interface ChangeError {
  index: number
  code: 'not_found' | 'ambiguous_ref' | 'invalid'
  message: string
  details?: unknown
}

/** Recomputes a cell's cached status/rework and its rounds from its (non-deleted) events. */
export async function recomputeCell(
  tx: Tx,
  cellId: string,
  events: CellEventLike[],
  now: Date,
): Promise<CellRow> {
  const h = computeCellHistory(events)
  const [updated] = await tx
    .update(cells)
    .set({
      status: h.status,
      statusChangedAt: h.statusChangedAt,
      reworkCount: h.reworkCount,
      updatedAt: now,
    })
    .where(eq(cells.id, cellId))
    .returning()
  await tx.delete(cellRounds).where(eq(cellRounds.cellId, cellId))
  if (h.rounds.length) {
    await tx.insert(cellRounds).values(
      h.rounds.map((r) => ({
        id: newId(),
        cellId,
        roundNo: r.roundNo,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        outcome: r.outcome,
      })),
    )
  }
  return updated!
}

export async function loadEvents(tx: Tx, cellIds: string[]): Promise<Map<string, CellEventLike[]>> {
  const map = new Map<string, CellEventLike[]>()
  if (cellIds.length === 0) return map
  const rows = await tx
    .select({
      id: cellEvents.id,
      cellId: cellEvents.cellId,
      toStatus: cellEvents.toStatus,
      happenedAt: cellEvents.happenedAt,
      recordedAt: cellEvents.recordedAt,
    })
    .from(cellEvents)
    .where(and(inArray(cellEvents.cellId, cellIds), isNull(cellEvents.deletedAt)))
  for (const r of rows) {
    const list = map.get(r.cellId) ?? []
    list.push({
      id: r.id,
      toStatus: r.toStatus,
      happenedAt: r.happenedAt,
      recordedAt: r.recordedAt,
    })
    map.set(r.cellId, list)
  }
  return map
}

/**
 * Applies a batch of cell changes all-or-nothing (spec 04 §4.1). With dryRun the whole batch runs
 * in a transaction that is rolled back, so the result is exact and nothing is written or notified.
 * A change may set status (with happenedAt/reason), assignees, planned dates, and add a comment
 * and/or a link.
 */
export async function applyChanges(
  ctx: ServiceContext,
  ref: string,
  input: ChangesInput,
): Promise<ChangesResultDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  try {
    return await withTx(ctx, async (tx, txCtx) => {
      const now = ctx.now()
      const [items, stages, members] = await Promise.all([
        loadItems(tx, project.id),
        loadStages(tx, project.id),
        tx
          .select({ userId: projectMembers.userId })
          .from(projectMembers)
          .where(eq(projectMembers.projectId, project.id)),
      ])
      const memberIds = new Set(members.map((m) => m.userId))
      const resolver = makeResolver(items, stages)
      const stagesById = new Map(stages.map((s) => [s.id, s]))

      const errors: ChangeError[] = []
      const resolved = input.changes.map((change, index) => {
        const item = resolver.tryItem(change.item)
        const stage = resolver.tryStage(change.stage)
        for (const [kind, r, refValue] of [
          ['item', item, change.item],
          ['stage', stage, change.stage],
        ] as const) {
          if (!r.ok) {
            errors.push({
              index,
              code: r.code,
              message:
                r.code === 'ambiguous_ref'
                  ? `${kind} "${refValue}" is ambiguous`
                  : `${kind} "${refValue}" not found`,
              details:
                r.code === 'ambiguous_ref'
                  ? { candidates: r.candidates }
                  : { suggestions: r.suggestions },
            })
          }
        }
        const hasDetails =
          change.assignees !== undefined ||
          change.plannedStart !== undefined ||
          change.plannedEnd !== undefined ||
          change.comment !== undefined ||
          change.link !== undefined
        if (change.status === undefined && !hasDetails) {
          errors.push({
            index,
            code: 'invalid',
            message:
              'Nothing to change: give status, assignees, plannedStart/plannedEnd, comment, or link',
          })
        }
        const happenedAt = change.happenedAt ? new Date(change.happenedAt) : now
        if (happenedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
          errors.push({ index, code: 'invalid', message: 'happenedAt is in the future' })
        }
        for (const a of change.assignees ?? []) {
          if ('userId' in a && !memberIds.has(a.userId)) {
            errors.push({
              index,
              code: 'invalid',
              message: `User ${a.userId} is not a member of this project`,
            })
          }
        }
        return {
          change,
          index,
          itemId: item.ok ? item.id : null,
          stageId: stage.ok ? stage.id : null,
          happenedAt,
        }
      })

      const itemIds = [...new Set(resolved.flatMap((r) => (r.itemId ? [r.itemId] : [])))]
      const cellRows = itemIds.length
        ? await tx.select().from(cells).where(inArray(cells.itemId, itemIds))
        : []
      const cellByKey = new Map(cellRows.map((c) => [`${c.itemId}:${c.stageId}`, c]))
      // Planned dates are checked against the cell's current values (and earlier changes in this batch).
      const planned = new Map(
        cellRows.map((c) => [c.id, { start: c.plannedStart, end: c.plannedEnd }]),
      )
      for (const r of resolved) {
        if (r.change.plannedStart === undefined && r.change.plannedEnd === undefined) continue
        const cell = cellByKey.get(`${r.itemId}:${r.stageId}`)
        if (!cell) continue
        const cur = planned.get(cell.id)!
        const next = {
          start: r.change.plannedStart === undefined ? cur.start : r.change.plannedStart,
          end: r.change.plannedEnd === undefined ? cur.end : r.change.plannedEnd,
        }
        if (next.start && next.end && next.start > next.end) {
          errors.push({
            index: r.index,
            code: 'invalid',
            message: `plannedStart ${next.start} is after plannedEnd ${next.end}`,
          })
        }
        planned.set(cell.id, next)
      }
      if (errors.length) {
        errors.sort((a, b) => a.index - b.index)
        throw invalid(
          `${new Set(errors.map((e) => e.index)).size} of ${input.changes.length} changes are invalid`,
          { errors },
        )
      }

      const eventsByCell = await loadEvents(
        tx,
        cellRows.map((c) => c.id),
      )
      const results: ChangeResultDto[] = []
      const statusChanged = new Map<string, { cell: CellRow; fromStatus: CellStatus }>()
      const detailsChanged = new Set<string>()
      for (const r of resolved) {
        let cell = cellByKey.get(`${r.itemId}:${r.stageId}`)
        if (!cell)
          throw new AppError('internal', `Missing cell for item ${r.itemId} and stage ${r.stageId}`)
        const itemPath = resolver.index.pathOf(r.itemId!)
        const stageName = stagesById.get(r.stageId!)!.name
        const events = eventsByCell.get(cell.id) ?? []
        const before = computeCellHistory(events).status
        const details: ChangeResultDto['details'] = []
        let backdated = false
        let statusWritten = false

        if (r.change.status !== undefined && statusAt(events, r.happenedAt) !== r.change.status) {
          const event = {
            id: newId(),
            toStatus: r.change.status,
            happenedAt: r.happenedAt,
            recordedAt: now,
          }
          await tx.insert(cellEvents).values({
            ...event,
            cellId: cell.id,
            actorUserId: ctx.actor!.userId,
            via: ctx.actor!.via,
            reason: r.change.reason || null,
          })
          events.push(event)
          eventsByCell.set(cell.id, events)
          cell = await recomputeCell(tx, cell.id, events, now)
          backdated = sortEvents(events).at(-1)!.id !== event.id
          statusWritten = true
          const prev = statusChanged.get(cell.id)
          statusChanged.set(cell.id, { cell, fromStatus: prev ? prev.fromStatus : before })
          await audit(tx, txCtx, {
            projectId: project.id,
            action: 'cell.status',
            targetType: 'cell',
            targetId: cell.id,
            before: { status: before },
            after: {
              status: cell.status,
              toStatus: r.change.status,
              happenedAt: r.happenedAt.toISOString(),
              reason: r.change.reason ?? null,
              item: itemPath,
              stage: stageName,
            },
          })
        }
        if (r.change.assignees !== undefined) {
          const next = r.change.assignees.map((a) =>
            'userId' in a ? { userId: a.userId } : { name: a.name },
          )
          await replaceAssignees(tx, txCtx, cell.id, next)
          details.push('assignees')
          await audit(tx, txCtx, {
            projectId: project.id,
            action: 'cell.update',
            targetType: 'cell',
            targetId: cell.id,
            after: { assignees: next, item: itemPath, stage: stageName },
          })
        }
        if (r.change.plannedStart !== undefined || r.change.plannedEnd !== undefined) {
          const p = planned.get(cell.id)!
          const [updated] = await tx
            .update(cells)
            .set({ plannedStart: p.start, plannedEnd: p.end, updatedAt: now })
            .where(eq(cells.id, cell.id))
            .returning()
          cell = updated!
          details.push('planned')
          await audit(tx, txCtx, {
            projectId: project.id,
            action: 'cell.update',
            targetType: 'cell',
            targetId: cell.id,
            after: { plannedStart: p.start, plannedEnd: p.end, item: itemPath, stage: stageName },
          })
          if (statusChanged.has(cell.id))
            statusChanged.set(cell.id, { ...statusChanged.get(cell.id)!, cell })
        }
        if (r.change.comment !== undefined) {
          const id = await insertComment(tx, txCtx, cell.id, r.change.comment)
          details.push('comment')
          await audit(tx, txCtx, {
            projectId: project.id,
            action: 'comment.create',
            targetType: 'comment',
            targetId: id,
            after: { cellId: cell.id, body: r.change.comment },
          })
        }
        if (r.change.link !== undefined) {
          const id = await insertLink(tx, txCtx, cell.id, r.change.link)
          details.push('link')
          await audit(tx, txCtx, {
            projectId: project.id,
            action: 'link.create',
            targetType: 'link',
            targetId: id,
            after: { cellId: cell.id, ...r.change.link },
          })
        }
        cellByKey.set(`${r.itemId}:${r.stageId}`, cell)
        if (details.length) detailsChanged.add(cell.id)
        results.push({
          index: r.index,
          cellId: cell.id,
          item: itemPath,
          stage: stageName,
          outcome: statusWritten || details.length ? 'changed' : 'unchanged',
          before: { status: before },
          after: { status: cell.status },
          backdatedBeforeLaterEvent: backdated,
          details,
        })
      }

      const touched = new Set([...statusChanged.keys(), ...detailsChanged])
      if (touched.size > MAX_INDIVIDUAL_EVENTS) {
        await notify(tx, txCtx, project.id, 'board.invalidated')
      } else {
        for (const { cell, fromStatus } of statusChanged.values()) {
          await notify(tx, txCtx, project.id, 'cell.updated', {
            cellId: cell.id,
            itemId: cell.itemId,
            stageId: cell.stageId,
            status: cell.status,
            fromStatus,
            rework: cell.reworkCount,
            stale: cellStale(cell, project, now),
            itemPath: resolver.index.pathOf(cell.itemId),
            stageName: stagesById.get(cell.stageId)!.name,
          })
        }
        for (const cellId of detailsChanged) {
          if (!statusChanged.has(cellId))
            await notify(tx, txCtx, project.id, 'cell.detail_updated', { cellId })
        }
      }

      const result: ChangesResultDto = {
        dryRun: input.dryRun,
        applied: results.filter((x) => x.outcome === 'changed').length,
        unchanged: results.filter((x) => x.outcome === 'unchanged').length,
        results,
      }
      if (input.dryRun) throw new DryRunRollback(result)
      return result
    })
  } catch (e) {
    if (e instanceof DryRunRollback) return e.result
    throw e
  }
}
