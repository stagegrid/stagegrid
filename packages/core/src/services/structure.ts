import { and, eq, inArray, isNull } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { cells, items, stages } from '../db/schema'
import { byPosition } from '../domain/tree'

export type StageRow = typeof stages.$inferSelect
export type ItemRow = typeof items.$inferSelect
export type CellRow = typeof cells.$inferSelect

export async function loadStages(
  db: DbOrTx,
  projectId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<StageRow[]> {
  const rows = await db
    .select()
    .from(stages)
    .where(
      opts.includeArchived
        ? eq(stages.projectId, projectId)
        : and(eq(stages.projectId, projectId), isNull(stages.archivedAt)),
    )
  return rows.sort(byPosition)
}

export async function loadItems(db: DbOrTx, projectId: string): Promise<ItemRow[]> {
  return db
    .select()
    .from(items)
    .where(and(eq(items.projectId, projectId), isNull(items.deletedAt)))
}

/** Cells of live items × active stages. */
export async function loadCells(db: DbOrTx, projectId: string): Promise<CellRow[]> {
  const rows = await db
    .select({ cell: cells })
    .from(cells)
    .innerJoin(items, eq(items.id, cells.itemId))
    .innerJoin(stages, eq(stages.id, cells.stageId))
    .where(and(eq(items.projectId, projectId), isNull(items.deletedAt), isNull(stages.archivedAt)))
  return rows.map((r) => r.cell)
}

export async function loadCellsFor(
  db: DbOrTx,
  projectIds: string[],
): Promise<(CellRow & { projectId: string })[]> {
  if (projectIds.length === 0) return []
  const rows = await db
    .select({ cell: cells, projectId: items.projectId })
    .from(cells)
    .innerJoin(items, eq(items.id, cells.itemId))
    .innerJoin(stages, eq(stages.id, cells.stageId))
    .where(
      and(inArray(items.projectId, projectIds), isNull(items.deletedAt), isNull(stages.archivedAt)),
    )
  return rows.map((r) => ({ ...r.cell, projectId: r.projectId }))
}

const CHUNK = 1000

/** Creates missing cells for the given item × stage pairs (existing pairs are left alone). */
export async function ensureCells(
  db: DbOrTx,
  pairs: { itemId: string; stageId: string }[],
  now: Date,
  newId: () => string,
): Promise<void> {
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK)
    if (chunk.length === 0) continue
    await db
      .insert(cells)
      .values(
        chunk.map((p) => ({
          id: newId(),
          itemId: p.itemId,
          stageId: p.stageId,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing()
  }
}
