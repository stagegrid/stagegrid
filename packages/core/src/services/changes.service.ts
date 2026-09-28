import type { CellStatus, ChangeResultDto, ChangesInput, ChangesResultDto } from '@stagegrid/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { Tx } from '../db/client'
import { cellEvents, cellRounds, cells } from '../db/schema'
import { type CellEventLike, computeCellHistory, sortEvents, statusAt } from '../domain/rounds'
import { AppError, invalid } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { requireProjectRole } from './access'
import { audit } from './audit'
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
      const [items, stages] = await Promise.all([
        loadItems(tx, project.id),
        loadStages(tx, project.id),
      ])
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
        if (change.status === undefined) {
          errors.push({
            index,
            code: 'invalid',
            message: 'Nothing to change: give at least status',
          })
        }
        const happenedAt = change.happenedAt ? new Date(change.happenedAt) : now
        if (happenedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
          errors.push({ index, code: 'invalid', message: 'happenedAt is in the future' })
        }
        return {
          change,
          index,
          itemId: item.ok ? item.id : null,
          stageId: stage.ok ? stage.id : null,
          happenedAt,
        }
      })
      if (errors.length) {
        throw invalid(
          `${new Set(errors.map((e) => e.index)).size} of ${input.changes.length} changes are invalid`,
          { errors },
        )
      }

      const cellRows = await tx
        .select()
        .from(cells)
        .where(inArray(cells.itemId, [...new Set(resolved.map((r) => r.itemId!))]))
      const cellByKey = new Map(cellRows.map((c) => [`${c.itemId}:${c.stageId}`, c]))
      const eventsByCell = await loadEvents(
        tx,
        cellRows.map((c) => c.id),
      )

      const results: ChangeResultDto[] = []
      const changed = new Map<string, { cell: CellRow; fromStatus: CellStatus }>()
      for (const r of resolved) {
        const cell = cellByKey.get(`${r.itemId}:${r.stageId}`)
        if (!cell)
          throw new AppError('internal', `Missing cell for item ${r.itemId} and stage ${r.stageId}`)
        const itemPath = resolver.index.pathOf(r.itemId!)
        const stageName = stagesById.get(r.stageId!)!.name
        const events = eventsByCell.get(cell.id) ?? []
        const before = computeCellHistory(events).status
        const target = r.change.status!
        if (statusAt(events, r.happenedAt) === target) {
          results.push({
            index: r.index,
            cellId: cell.id,
            item: itemPath,
            stage: stageName,
            outcome: 'unchanged',
            before: { status: before },
            after: { status: before },
            backdatedBeforeLaterEvent: false,
          })
          continue
        }
        const event = { id: newId(), toStatus: target, happenedAt: r.happenedAt, recordedAt: now }
        await tx.insert(cellEvents).values({
          ...event,
          cellId: cell.id,
          actorUserId: ctx.actor!.userId,
          via: ctx.actor!.via,
          reason: r.change.reason || null,
        })
        events.push(event)
        eventsByCell.set(cell.id, events)
        const updated = await recomputeCell(tx, cell.id, events, now)
        cellByKey.set(`${r.itemId}:${r.stageId}`, updated)
        const backdated = sortEvents(events).at(-1)!.id !== event.id
        if (!changed.has(cell.id)) changed.set(cell.id, { cell: updated, fromStatus: before })
        else changed.set(cell.id, { cell: updated, fromStatus: changed.get(cell.id)!.fromStatus })
        await audit(tx, txCtx, {
          projectId: project.id,
          action: 'cell.status',
          targetType: 'cell',
          targetId: cell.id,
          before: { status: before },
          after: {
            status: updated.status,
            toStatus: target,
            happenedAt: r.happenedAt.toISOString(),
            reason: r.change.reason ?? null,
            item: itemPath,
            stage: stageName,
          },
        })
        results.push({
          index: r.index,
          cellId: cell.id,
          item: itemPath,
          stage: stageName,
          outcome: 'changed',
          before: { status: before },
          after: { status: updated.status },
          backdatedBeforeLaterEvent: backdated,
        })
      }

      if (changed.size > 0 && changed.size <= MAX_INDIVIDUAL_EVENTS) {
        for (const { cell, fromStatus } of changed.values()) {
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
      } else if (changed.size > MAX_INDIVIDUAL_EVENTS) {
        await notify(tx, txCtx, project.id, 'board.invalidated')
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
