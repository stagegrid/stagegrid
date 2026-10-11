import { createHash } from 'node:crypto'

import type {
  CreateContextInput,
  OutdatedDocumentDto,
  TaskContextDto,
  TaskContextSummaryDto,
} from '@stagegrid/shared'
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import {
  type ContextManifest,
  documentRevisions,
  documents,
  taskContextRevisions,
} from '../db/schema'
import { conflict, invalid, notFound } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'
import { isApproved } from './docs.service'
import { loadTaskInProject } from './task-access'

type ContextRow = typeof taskContextRevisions.$inferSelect

/** Stable text for hashing: same manifest, same hash, whatever the key order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

export const hashManifest = (m: ContextManifest): string =>
  createHash('sha256').update(canonicalJson(m)).digest('hex')

async function outdatedDocuments(
  db: DbOrTx,
  manifests: Map<string, ContextManifest>,
): Promise<Map<string, OutdatedDocumentDto[]>> {
  const out = new Map<string, OutdatedDocumentDto[]>()
  const docIds = [
    ...new Set([...manifests.values()].flatMap((m) => m.documents.map((d) => d.documentId))),
  ]
  if (docIds.length === 0) return out
  const current = await db
    .select({ id: documents.id, version: documents.version, deletedAt: documents.deletedAt })
    .from(documents)
    .where(inArray(documents.id, docIds))
  const byId = new Map(current.map((d) => [d.id, d]))
  for (const [taskId, m] of manifests) {
    const list: OutdatedDocumentDto[] = []
    for (const d of m.documents) {
      const now = byId.get(d.documentId)
      if (now && !now.deletedAt && now.version > d.version)
        list.push({
          documentId: d.documentId,
          title: d.title,
          pinnedVersion: d.version,
          currentVersion: now.version,
        })
    }
    out.set(taskId, list)
  }
  return out
}

/** The latest pinned context of each task, with documents that have moved on since flagged. */
export async function latestContexts(
  db: DbOrTx,
  taskIds: string[],
): Promise<Map<string, TaskContextSummaryDto>> {
  const result = new Map<string, TaskContextSummaryDto>()
  if (taskIds.length === 0) return result
  const rows = await db
    .select()
    .from(taskContextRevisions)
    .where(inArray(taskContextRevisions.taskId, taskIds))
    .orderBy(desc(taskContextRevisions.revisionNo))
  const latest = new Map<string, ContextRow>()
  for (const r of rows) if (!latest.has(r.taskId)) latest.set(r.taskId, r)
  const outdated = await outdatedDocuments(
    db,
    new Map([...latest].map(([taskId, r]) => [taskId, r.manifest])),
  )
  for (const [taskId, r] of latest) {
    result.set(taskId, {
      revisionId: r.id,
      revisionNo: r.revisionNo,
      createdAt: r.createdAt.toISOString(),
      outdated: outdated.get(taskId) ?? [],
    })
  }
  return result
}

function toContextDto(r: ContextRow, outdated: OutdatedDocumentDto[]): TaskContextDto {
  return {
    revisionId: r.id,
    revisionNo: r.revisionNo,
    createdAt: r.createdAt.toISOString(),
    outdated,
    manifest: r.manifest,
    manifestHash: r.manifestHash,
  }
}

export async function getTaskContext(
  db: DbOrTx,
  taskId: string,
  revisionId?: string,
): Promise<TaskContextDto | null> {
  const [row] = await db
    .select()
    .from(taskContextRevisions)
    .where(
      and(
        eq(taskContextRevisions.taskId, taskId),
        revisionId ? eq(taskContextRevisions.id, revisionId) : undefined,
      ),
    )
    .orderBy(desc(taskContextRevisions.revisionNo))
    .limit(1)
  if (!row) return null
  const outdated =
    (await outdatedDocuments(db, new Map([[taskId, row.manifest]]))).get(taskId) ?? []
  return toContextDto(row, outdated)
}

/**
 * Reasons a task can't be marked ready. Work for an AI employee needs an agreed context whose
 * documents still exist in the project; approval checks join this list with the document approval work.
 */
export async function readinessReasons(
  db: DbOrTx,
  project: ProjectRow,
  task: { id: string; employeeId: string | null },
): Promise<string[]> {
  if (!task.employeeId) return []
  const ctx = await getTaskContext(db, task.id)
  if (!ctx)
    return ['Pin the context the employee should work from (documents, sources, decisions).']
  const reasons: string[] = []
  const docIds = ctx.manifest.documents.map((d) => d.documentId)
  if (docIds.length) {
    const live = await db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          inArray(documents.id, docIds),
          eq(documents.projectId, project.id),
          isNull(documents.deletedAt),
        ),
      )
    const liveIds = new Set(live.map((d) => d.id))
    for (const d of ctx.manifest.documents)
      if (!liveIds.has(d.documentId))
        reasons.push(`"${d.title}" is no longer available. Pin the context again without it.`)
    // With the analyst workflow on, the work follows approved requirements only.
    if (project.team.analyst.enabled) {
      for (const d of ctx.manifest.documents) {
        if (!liveIds.has(d.documentId)) continue
        if (!(await isApproved(db, d.documentId, d.version)))
          reasons.push(
            `"${d.title}" (version ${d.version}) isn't approved yet. A person approves that version first.`,
          )
      }
    }
  }
  if (
    ctx.manifest.documents.length + ctx.manifest.sources.length + ctx.manifest.decisions.length ===
    0
  )
    reasons.push('The pinned context is empty. Add at least one document, source or decision.')
  return reasons
}

/**
 * Pins a new immutable context revision for a task. Documents are pinned at their latest saved
 * revision; sources are kept as text. Earlier revisions stay exactly as they were.
 */
export async function createContextRevision(
  ctx: ServiceContext,
  ref: string,
  taskId: string,
  input: CreateContextInput,
): Promise<TaskContextDto> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  return withTx(ctx, async (tx, txCtx) => {
    const task = await loadTaskInProject(tx, project, taskId)
    if (task.state === 'done' || task.state === 'cancelled')
      throw conflict("A finished or cancelled task's context can't change.")
    const now = ctx.now()

    const documentEntries: ContextManifest['documents'] = []
    const uniqueDocIds = [...new Set(input.documentIds)]
    if (uniqueDocIds.length) {
      const docs = await tx
        .select({ id: documents.id, title: documents.title, version: documents.version })
        .from(documents)
        .where(
          and(
            inArray(documents.id, uniqueDocIds),
            eq(documents.projectId, project.id),
            isNull(documents.deletedAt),
          ),
        )
      if (docs.length !== uniqueDocIds.length) {
        const found = new Set(docs.map((d) => d.id))
        const missing = uniqueDocIds.filter((id) => !found.has(id))
        throw invalid(`Document ${missing.join(', ')} isn't in this project`, {
          documentIds: missing,
        })
      }
      const revs = await tx
        .select({
          id: documentRevisions.id,
          documentId: documentRevisions.documentId,
          version: documentRevisions.version,
        })
        .from(documentRevisions)
        .where(inArray(documentRevisions.documentId, uniqueDocIds))
      for (const d of docs) {
        const rev = revs.find((r) => r.documentId === d.id && r.version === d.version)
        if (!rev) throw invalid(`"${d.title}" has no saved revision to pin yet. Save it first.`)
        documentEntries.push({
          documentId: d.id,
          revisionId: rev.id,
          version: d.version,
          title: d.title,
        })
      }
      documentEntries.sort(
        (a, b) => uniqueDocIds.indexOf(a.documentId) - uniqueDocIds.indexOf(b.documentId),
      )
    }

    const manifest: ContextManifest = {
      schemaVersion: 1,
      documents: documentEntries,
      sources: input.sources.map((s) => ({
        title: s.title,
        url: s.url,
        content: s.content,
        retrievedAt: now.toISOString(),
      })),
      decisions: input.decisions,
    }
    const [{ last } = { last: null }] = await tx
      .select({ last: max(taskContextRevisions.revisionNo) })
      .from(taskContextRevisions)
      .where(eq(taskContextRevisions.taskId, taskId))
    const [row] = await tx
      .insert(taskContextRevisions)
      .values({
        id: newId(),
        taskId,
        revisionNo: (last ?? 0) + 1,
        manifest,
        manifestHash: hashManifest(manifest),
        createdBy: ctx.actor!.userId,
        createdAt: now,
      })
      .returning()
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'task.context',
      targetType: 'task',
      targetId: taskId,
      after: {
        revisionNo: row!.revisionNo,
        documents: documentEntries.length,
        sources: manifest.sources.length,
        decisions: manifest.decisions.length,
      },
    })
    await notify(tx, txCtx, project.id, 'task.updated', { taskId })
    return toContextDto(row!, [])
  })
}

export async function getContextOrThrow(
  db: DbOrTx,
  taskId: string,
  revisionId?: string,
): Promise<TaskContextDto> {
  const c = await getTaskContext(db, taskId, revisionId)
  if (!c) throw notFound('No context has been pinned for this task')
  return c
}
