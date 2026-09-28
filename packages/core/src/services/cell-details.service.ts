import type { AssigneeDto, CommentDto, LinkDto, LinkInput } from '@stagegrid/shared'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { cellAssignees, cellLinks, cells, comments, items, users } from '../db/schema'
import { forbidden, notFound } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'

export type ResolvedAssignee = { userId: string; name?: never } | { name: string; userId?: never }

export async function loadAssignees(
  db: DbOrTx,
  cellIds: string[],
): Promise<Map<string, AssigneeDto[]>> {
  const map = new Map<string, AssigneeDto[]>()
  if (cellIds.length === 0) return map
  const rows = await db
    .select({
      cellId: cellAssignees.cellId,
      userId: cellAssignees.userId,
      displayName: cellAssignees.displayName,
      userName: users.name,
    })
    .from(cellAssignees)
    .leftJoin(users, eq(users.id, cellAssignees.userId))
    .where(inArray(cellAssignees.cellId, cellIds))
    .orderBy(asc(cellAssignees.createdAt), asc(cellAssignees.id))
  for (const r of rows) {
    const list = map.get(r.cellId) ?? []
    list.push({ userId: r.userId, name: r.userId ? (r.userName ?? 'Unknown') : r.displayName! })
    map.set(r.cellId, list)
  }
  return map
}

export async function loadCommentsByCell(
  db: DbOrTx,
  cellIds: string[],
): Promise<Map<string, CommentDto[]>> {
  const map = new Map<string, CommentDto[]>()
  if (cellIds.length === 0) return map
  const rows = await db
    .select({ c: comments, authorName: users.name })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(and(inArray(comments.cellId, cellIds), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt), asc(comments.id))
  for (const { c, authorName } of rows) {
    const list = map.get(c.cellId) ?? []
    list.push({
      id: c.id,
      body: c.body,
      author: { userId: c.authorId, name: authorName ?? 'System', via: c.via },
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
    })
    map.set(c.cellId, list)
  }
  return map
}

export async function loadComments(db: DbOrTx, cellId: string): Promise<CommentDto[]> {
  return (await loadCommentsByCell(db, [cellId])).get(cellId) ?? []
}

export async function loadLinksByCell(
  db: DbOrTx,
  cellIds: string[],
): Promise<Map<string, LinkDto[]>> {
  const map = new Map<string, LinkDto[]>()
  if (cellIds.length === 0) return map
  const rows = await db
    .select()
    .from(cellLinks)
    .where(and(inArray(cellLinks.cellId, cellIds), isNull(cellLinks.deletedAt)))
    .orderBy(asc(cellLinks.createdAt), asc(cellLinks.id))
  for (const l of rows) {
    const list = map.get(l.cellId) ?? []
    list.push({
      id: l.id,
      title: l.title,
      url: l.url,
      kind: l.kind,
      createdAt: l.createdAt.toISOString(),
    })
    map.set(l.cellId, list)
  }
  return map
}

export async function loadLinks(db: DbOrTx, cellId: string): Promise<LinkDto[]> {
  return (await loadLinksByCell(db, [cellId])).get(cellId) ?? []
}

/** Replaces a cell's assignees. Callers validate that user ids are project members. */
export async function replaceAssignees(
  tx: DbOrTx,
  ctx: ServiceContext,
  cellId: string,
  next: ResolvedAssignee[],
): Promise<void> {
  await tx.delete(cellAssignees).where(eq(cellAssignees.cellId, cellId))
  const seen = new Set<string>()
  const rows = next.filter((a) => {
    const key = a.userId ? `u:${a.userId}` : `n:${a.name!.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (rows.length === 0) return
  await tx.insert(cellAssignees).values(
    rows.map((a) => ({
      id: newId(),
      cellId,
      userId: a.userId ?? null,
      displayName: a.userId ? null : a.name!,
      createdBy: ctx.actor?.userId ?? null,
      createdAt: ctx.now(),
    })),
  )
}

export async function insertComment(
  tx: DbOrTx,
  ctx: ServiceContext,
  cellId: string,
  body: string,
): Promise<string> {
  const id = newId()
  await tx.insert(comments).values({
    id,
    cellId,
    authorId: ctx.actor?.userId ?? null,
    via: ctx.actor?.via ?? 'system',
    body,
    createdAt: ctx.now(),
  })
  return id
}

export async function insertLink(
  tx: DbOrTx,
  ctx: ServiceContext,
  cellId: string,
  link: LinkInput,
): Promise<string> {
  const id = newId()
  await tx.insert(cellLinks).values({
    id,
    cellId,
    title: link.title,
    url: link.url,
    kind: link.kind,
    createdBy: ctx.actor?.userId ?? null,
    createdAt: ctx.now(),
  })
  return id
}

async function cellInProject(db: DbOrTx, project: ProjectRow, cellId: string) {
  const [row] = await db
    .select({ id: cells.id })
    .from(cells)
    .innerJoin(items, eq(items.id, cells.itemId))
    .where(and(eq(cells.id, cellId), eq(items.projectId, project.id)))
  if (!row) throw notFound('Cell not found')
}

export async function addComment(
  ctx: ServiceContext,
  ref: string,
  cellId: string,
  body: string,
): Promise<CommentDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    await cellInProject(tx, project, cellId)
    const id = await insertComment(tx, txCtx, cellId, body)
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'comment.create',
      targetType: 'comment',
      targetId: id,
      after: { cellId, body },
    })
    await notify(tx, txCtx, project.id, 'cell.detail_updated', { cellId })
    return (await loadComments(tx, cellId)).find((c) => c.id === id)!
  })
}

async function commentInProject(db: DbOrTx, project: ProjectRow, commentId: string) {
  const [row] = await db
    .select({ c: comments })
    .from(comments)
    .innerJoin(cells, eq(cells.id, comments.cellId))
    .innerJoin(items, eq(items.id, cells.itemId))
    .where(
      and(eq(comments.id, commentId), eq(items.projectId, project.id), isNull(comments.deletedAt)),
    )
  if (!row) throw notFound('Comment not found')
  return row.c
}

/** Authors edit their own comments; owners (and admins) can edit or delete anyone's. */
export async function updateComment(
  ctx: ServiceContext,
  ref: string,
  commentId: string,
  body: string | null,
): Promise<void> {
  const { project, role, actor } = await requireProjectRole(ctx, ref, 'editor')
  await withTx(ctx, async (tx, txCtx) => {
    const c = await commentInProject(tx, project, commentId)
    if (c.authorId !== actor.userId && role !== 'owner')
      throw forbidden('Only the author or a project owner can change this comment')
    const now = ctx.now()
    if (body === null)
      await tx.update(comments).set({ deletedAt: now }).where(eq(comments.id, commentId))
    else await tx.update(comments).set({ body, editedAt: now }).where(eq(comments.id, commentId))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: body === null ? 'comment.delete' : 'comment.update',
      targetType: 'comment',
      targetId: commentId,
      before: { body: c.body },
      after: body === null ? null : { body },
    })
    await notify(tx, txCtx, project.id, 'cell.detail_updated', { cellId: c.cellId })
  })
}

export async function addLink(
  ctx: ServiceContext,
  ref: string,
  cellId: string,
  link: LinkInput,
): Promise<LinkDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    await cellInProject(tx, project, cellId)
    const id = await insertLink(tx, txCtx, cellId, link)
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'link.create',
      targetType: 'link',
      targetId: id,
      after: { cellId, ...link },
    })
    await notify(tx, txCtx, project.id, 'cell.detail_updated', { cellId })
    return (await loadLinks(tx, cellId)).find((l) => l.id === id)!
  })
}

export async function deleteLink(ctx: ServiceContext, ref: string, linkId: string): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  await withTx(ctx, async (tx, txCtx) => {
    const [row] = await tx
      .select({ l: cellLinks })
      .from(cellLinks)
      .innerJoin(cells, eq(cells.id, cellLinks.cellId))
      .innerJoin(items, eq(items.id, cells.itemId))
      .where(
        and(eq(cellLinks.id, linkId), eq(items.projectId, project.id), isNull(cellLinks.deletedAt)),
      )
    if (!row) throw notFound('Link not found')
    await tx.update(cellLinks).set({ deletedAt: ctx.now() }).where(eq(cellLinks.id, linkId))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'link.delete',
      targetType: 'link',
      targetId: linkId,
      before: { title: row.l.title, url: row.l.url },
    })
    await notify(tx, txCtx, project.id, 'cell.detail_updated', { cellId: row.l.cellId })
  })
}
