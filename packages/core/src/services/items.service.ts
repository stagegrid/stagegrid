import {
  type CreateItemsInput,
  type ItemTreeInput,
  LIMITS,
  type MoveItemInput,
} from '@stagegrid/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { generateNKeysBetween } from 'fractional-indexing'

import { items } from '../db/schema'
import { byPosition, descendantIds, lastChildPosition, wouldCreateCycle } from '../domain/tree'
import { conflict, invalid } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'
import { makeResolver } from './refs'
import { ensureCells, type ItemRow, loadItems, loadStages } from './structure'

function countNodes(trees: ItemTreeInput[]): number {
  return trees.reduce((n, t) => n + 1 + countNodes(t.children ?? []), 0)
}

/**
 * Position for a node placed under `parentId`, optionally right before/after a sibling.
 * `siblings` must exclude the node being moved.
 */
function placement(
  all: ItemRow[],
  parentId: string | null,
  opts: { before?: ItemRow; after?: ItemRow },
  count: number,
): string[] {
  const siblings = all.filter((i) => i.parentId === parentId).sort(byPosition)
  const anchor = opts.after ?? opts.before
  if (anchor && anchor.parentId !== parentId)
    throw invalid('before/after must be a sibling under the same parent')
  let lo: string | null
  let hi: string | null
  if (opts.after) {
    const i = siblings.findIndex((s) => s.id === opts.after!.id)
    lo = siblings[i]!.position
    hi = siblings[i + 1]?.position ?? null
  } else if (opts.before) {
    const i = siblings.findIndex((s) => s.id === opts.before!.id)
    lo = siblings[i - 1]?.position ?? null
    hi = siblings[i]!.position
  } else {
    lo = lastChildPosition(siblings, parentId)
    hi = null
  }
  return generateNKeysBetween(lo, hi, count)
}

export interface CreatedItem {
  id: string
  path: string
}

export async function createItems(
  ctx: ServiceContext,
  ref: string,
  input: CreateItemsInput,
): Promise<{ items: CreatedItem[] }> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  const total = countNodes(input.items)
  if (total > LIMITS.itemsPerCreate)
    throw invalid(`At most ${LIMITS.itemsPerCreate} items per request`)
  return withTx(ctx, async (tx, txCtx) => {
    const now = ctx.now()
    const existing = await loadItems(tx, project.id)
    if (existing.length + total > LIMITS.itemsPerProject)
      throw conflict(`A project can have at most ${LIMITS.itemsPerProject} items`)
    const stages = await loadStages(tx, project.id)
    const resolve = makeResolver(existing, stages)
    const parent = input.parent ? resolve.item(input.parent) : null
    const before = input.before ? resolve.item(input.before) : undefined
    const after = input.after ? resolve.item(input.after) : undefined
    const topKeys = placement(existing, parent?.id ?? null, { before, after }, input.items.length)

    const rows: (typeof items.$inferInsert)[] = []
    const created: { id: string; name: string; parentId: string | null; position: string }[] = []
    const walk = (nodes: ItemTreeInput[], parentId: string | null, keys: string[]) => {
      nodes.forEach((node, i) => {
        const id = newId()
        const row = {
          id,
          projectId: project.id,
          parentId,
          name: node.name,
          position: keys[i]!,
          createdAt: now,
          updatedAt: now,
        }
        rows.push(row)
        created.push(row)
        const kids = node.children ?? []
        if (kids.length) walk(kids, id, generateNKeysBetween(null, null, kids.length))
      })
    }
    walk(input.items, parent?.id ?? null, topKeys)
    for (let i = 0; i < rows.length; i += 1000)
      await tx.insert(items).values(rows.slice(i, i + 1000))
    await ensureCells(
      tx,
      rows.flatMap((r) => stages.map((s) => ({ itemId: r.id!, stageId: s.id }))),
      now,
      newId,
    )

    const after2 = makeResolver([...existing, ...(created as ItemRow[])], stages)
    const result = created.map((c) => ({ id: c.id, path: after2.index.pathOf(c.id) }))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'item.create',
      targetType: 'item',
      targetId: rows[0]!.id!,
      after: {
        count: rows.length,
        roots: input.items.map((t) => t.name),
        parent: parent ? after2.index.pathOf(parent.id) : null,
      },
    })
    await notify(tx, txCtx, project.id, 'item.created', {
      itemIds: rows.length <= 200 ? rows.map((r) => r.id) : [],
    })
    return { items: result }
  })
}

export async function renameItem(
  ctx: ServiceContext,
  ref: string,
  itemRef: string,
  name: string,
): Promise<CreatedItem> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const all = await loadItems(tx, project.id)
    const item = makeResolver(all, []).item(itemRef)
    await tx.update(items).set({ name, updatedAt: ctx.now() }).where(eq(items.id, item.id))
    const updated = all.map((i) => (i.id === item.id ? { ...i, name } : i))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'item.update',
      targetType: 'item',
      targetId: item.id,
      before: { name: item.name },
      after: { name },
    })
    await notify(tx, txCtx, project.id, 'item.updated', { itemIds: [item.id] })
    return { id: item.id, path: makeResolver(updated, []).index.pathOf(item.id) }
  })
}

export async function moveItem(
  ctx: ServiceContext,
  ref: string,
  itemRef: string,
  input: MoveItemInput,
): Promise<CreatedItem> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const all = await loadItems(tx, project.id)
    const resolve = makeResolver(all, [])
    const item = resolve.item(itemRef)
    const before = input.before ? resolve.item(input.before) : undefined
    const after = input.after ? resolve.item(input.after) : undefined
    let parentId: string | null
    if (input.parent === undefined) parentId = (after ?? before)?.parentId ?? item.parentId
    else parentId = input.parent === null ? null : resolve.item(input.parent).id
    if (wouldCreateCycle(all, item.id, parentId))
      throw invalid("An item can't be moved inside itself")
    if (before?.id === item.id || after?.id === item.id)
      throw invalid('before/after must be a different item')
    const others = all.filter((i) => i.id !== item.id)
    const [position] = placement(others, parentId, { before, after }, 1)
    await tx
      .update(items)
      .set({ parentId, position: position!, updatedAt: ctx.now() })
      .where(eq(items.id, item.id))
    const moved = all.map((i) => (i.id === item.id ? { ...i, parentId, position: position! } : i))
    const path = makeResolver(moved, []).index.pathOf(item.id)
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'item.move',
      targetType: 'item',
      targetId: item.id,
      before: { path: resolve.index.pathOf(item.id) },
      after: { path },
    })
    await notify(tx, txCtx, project.id, 'item.moved', { itemIds: [item.id] })
    return { id: item.id, path }
  })
}

export async function deleteItem(
  ctx: ServiceContext,
  ref: string,
  itemRef: string,
): Promise<{ deletedCount: number }> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const all = await loadItems(tx, project.id)
    const resolve = makeResolver(all, [])
    const item = resolve.item(itemRef)
    const ids = [item.id, ...descendantIds(all, item.id)]
    const now = ctx.now()
    await tx
      .update(items)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(items.projectId, project.id), inArray(items.id, ids), isNull(items.deletedAt)))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'item.delete',
      targetType: 'item',
      targetId: item.id,
      before: { path: resolve.index.pathOf(item.id), count: ids.length },
    })
    await notify(tx, txCtx, project.id, 'item.deleted', { itemIds: ids.length <= 200 ? ids : [] })
    return { deletedCount: ids.length }
  })
}
