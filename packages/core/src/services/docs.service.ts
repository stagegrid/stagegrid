import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  buildDocModel,
  BUILTIN_TEMPLATES,
  type Draft,
  renderConfluence,
  renderHtml,
  renderMarkdown,
  type ResolveContext,
  type ResolvedTemplate,
  resolveTemplate,
  type TemplateSchema,
  templateSchema,
  validateDraft,
} from '@stagegrid/docs'
import { extractSections, readDocx, renderDocx } from '@stagegrid/docs/docx'
import type {
  DocTemplateDto,
  DocTemplateLevel,
  DocumentDto,
  DocumentSummaryDto,
  SaveDocDraftInput,
} from '@stagegrid/shared'
import { zonedDate } from '@stagegrid/shared'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import {
  cellLinks,
  cells,
  docTemplates,
  documentRevisions,
  documents,
  projectDocTemplates,
  users,
} from '../db/schema'
import { orderDepthFirst } from '../domain/tree'
import { AppError, conflict, invalid, notFound } from '../errors'
import { isUuid, newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireAdmin, requireProjectRole } from './access'
import { audit } from './audit'
import { requireActor, type ServiceConfig, type ServiceContext, withTx } from './context'
import { makeResolver } from './refs'
import { getRelease } from './releases.service'
import { loadItems, loadStages } from './structure'

type TemplateRow = typeof docTemplates.$inferSelect
type DocumentRow = typeof documents.$inferSelect

// ---------------------------------------------------------------- templates

/** Inserts missing built-in templates (idempotent; called on start and lazily). */
export async function ensureBuiltinTemplates(db: DbOrTx, now = new Date()): Promise<void> {
  const existing = new Set(
    (await db.select({ key: docTemplates.key }).from(docTemplates)).map((r) => r.key),
  )
  const missing = BUILTIN_TEMPLATES.filter((t) => !existing.has(t.key))
  if (missing.length === 0) return
  await db
    .insert(docTemplates)
    .values(
      missing.map((t) => ({
        id: newId(),
        key: t.key,
        name: t.name,
        kind: t.schema.kind,
        level: t.level,
        schema: t.schema,
        builtin: true,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing()
}

function toTemplateDto(t: TemplateRow): DocTemplateDto {
  const schema = t.schema as TemplateSchema
  return {
    id: t.id,
    key: t.key,
    name: t.name,
    kind: t.kind,
    level: t.level,
    builtin: t.builtin,
    archived: t.archivedAt !== null,
    hasBaseDocx: t.baseDocx !== null,
    sectionCount:
      (schema.sections?.length ?? 0) + (schema.kind === 'form' ? schema.fields.length : 0),
  }
}

async function findTemplate(db: DbOrTx, ref: string): Promise<TemplateRow> {
  const [t] = await db
    .select()
    .from(docTemplates)
    .where(isUuid(ref) ? eq(docTemplates.id, ref) : eq(docTemplates.key, ref.trim().toLowerCase()))
  if (!t) throw notFound(`No template "${ref}"`)
  return t
}

export async function listTemplates(ctx: ServiceContext): Promise<DocTemplateDto[]> {
  requireAdmin(ctx)
  await ensureBuiltinTemplates(ctx.db, ctx.now())
  return (
    await ctx.db
      .select()
      .from(docTemplates)
      .orderBy(desc(docTemplates.builtin), asc(docTemplates.name))
  ).map(toTemplateDto)
}

export async function getTemplate(
  ctx: ServiceContext,
  ref: string,
): Promise<DocTemplateDto & { schema: TemplateSchema }> {
  requireActor(ctx)
  await ensureBuiltinTemplates(ctx.db, ctx.now())
  const t = await findTemplate(ctx.db, ref)
  return { ...toTemplateDto(t), schema: t.schema as TemplateSchema }
}

const keySchema = (k: string) => /^[a-z0-9-]{2,40}$/.test(k)

export async function createTemplate(
  ctx: ServiceContext,
  input: { key: string; name: string; level: DocTemplateLevel; schema: unknown },
): Promise<DocTemplateDto> {
  const actor = requireAdmin(ctx)
  if (!keySchema(input.key)) throw invalid('key must be 2–40 lowercase letters, digits, or hyphens')
  const schema = parseTemplateSchema(input.schema)
  await ensureBuiltinTemplates(ctx.db, ctx.now())
  return withTx(ctx, async (tx, txCtx) => {
    const [dupe] = await tx
      .select({ id: docTemplates.id })
      .from(docTemplates)
      .where(eq(docTemplates.key, input.key))
    if (dupe) throw conflict('A template with this key already exists')
    const now = ctx.now()
    const [row] = await tx
      .insert(docTemplates)
      .values({
        id: newId(),
        key: input.key,
        name: input.name.trim(),
        kind: schema.kind,
        level: input.level,
        schema,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    await audit(tx, txCtx, {
      action: 'doc.template_create',
      targetType: 'doc_template',
      targetId: row!.id,
      after: { key: input.key },
    })
    return toTemplateDto(row!)
  })
}

function parseTemplateSchema(value: unknown): TemplateSchema {
  const r = templateSchema.safeParse(value)
  if (!r.success)
    throw invalid('Template schema is invalid', {
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  return r.data
}

/** Built-in templates can be renamed, archived, and given a base document, but their sections are fixed. */
export async function updateTemplate(
  ctx: ServiceContext,
  ref: string,
  input: { name?: string; level?: DocTemplateLevel; schema?: unknown; archived?: boolean },
): Promise<DocTemplateDto> {
  requireAdmin(ctx)
  return withTx(ctx, async (tx, txCtx) => {
    const t = await findTemplate(tx, ref)
    if (t.builtin && (input.schema !== undefined || input.level !== undefined))
      throw conflict(
        "Built-in templates' sections can't be edited. Create your own template instead.",
      )
    const schema = input.schema === undefined ? undefined : parseTemplateSchema(input.schema)
    const [row] = await tx
      .update(docTemplates)
      .set({
        name: input.name?.trim() || t.name,
        level: input.level ?? t.level,
        ...(schema ? { schema, kind: schema.kind } : {}),
        archivedAt: input.archived === undefined ? t.archivedAt : input.archived ? ctx.now() : null,
        updatedAt: ctx.now(),
      })
      .where(eq(docTemplates.id, t.id))
      .returning()
    await audit(tx, txCtx, {
      action: 'doc.template_update',
      targetType: 'doc_template',
      targetId: t.id,
      after: { name: input.name, archived: input.archived, schemaChanged: !!schema },
    })
    return toTemplateDto(row!)
  })
}

export async function setBaseDocx(
  ctx: ServiceContext,
  ref: string,
  bytes: Uint8Array | null,
): Promise<DocTemplateDto> {
  requireAdmin(ctx)
  if (bytes) {
    try {
      readDocx(bytes)
    } catch (e) {
      throw invalid((e as Error).message)
    }
  }
  const t = await findTemplate(ctx.db, ref)
  const [row] = await ctx.db
    .update(docTemplates)
    .set({ baseDocx: bytes ? Buffer.from(bytes) : null, updatedAt: ctx.now() })
    .where(eq(docTemplates.id, t.id))
    .returning()
  await audit(ctx.db, ctx, {
    action: 'doc.template_base',
    targetType: 'doc_template',
    targetId: t.id,
    after: { hasBaseDocx: !!bytes },
  })
  return toTemplateDto(row!)
}

export async function getBaseDocx(ctx: ServiceContext, ref: string): Promise<Uint8Array | null> {
  requireAdmin(ctx)
  const t = await findTemplate(ctx.db, ref)
  return t.baseDocx ? new Uint8Array(t.baseDocx) : null
}

export function importSections(ctx: ServiceContext, bytes: Uint8Array) {
  requireAdmin(ctx)
  try {
    return extractSections(bytes)
  } catch (e) {
    throw invalid((e as Error).message)
  }
}

/**
 * Templates usable in a project: its selection, or every active template when nothing is selected.
 * `all` lists every active template with its `selected` flag (for the settings screen).
 */
export async function projectTemplates(
  ctx: ServiceContext,
  ref: string,
  opts: { all?: boolean } = {},
): Promise<(DocTemplateDto & { selected: boolean })[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  await ensureBuiltinTemplates(ctx.db, ctx.now())
  const all = (
    await ctx.db
      .select()
      .from(docTemplates)
      .where(isNull(docTemplates.archivedAt))
      .orderBy(desc(docTemplates.builtin), asc(docTemplates.name))
  ).map(toTemplateDto)
  const selected = new Set(
    (
      await ctx.db
        .select()
        .from(projectDocTemplates)
        .where(eq(projectDocTemplates.projectId, project.id))
    ).map((r) => r.templateId),
  )
  return all
    .filter((t) => opts.all || selected.size === 0 || selected.has(t.id))
    .map((t) => ({ ...t, selected: selected.has(t.id) }))
}

export async function setProjectTemplates(
  ctx: ServiceContext,
  ref: string,
  templateIds: string[],
): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  await withTx(ctx, async (tx, txCtx) => {
    await tx.delete(projectDocTemplates).where(eq(projectDocTemplates.projectId, project.id))
    if (templateIds.length) {
      const found = await tx
        .select({ id: docTemplates.id })
        .from(docTemplates)
        .where(inArray(docTemplates.id, templateIds))
      if (found.length !== new Set(templateIds).size) throw notFound('Unknown template id')
      await tx
        .insert(projectDocTemplates)
        .values(
          [...new Set(templateIds)].map((templateId) => ({ projectId: project.id, templateId })),
        )
    }
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'doc.project_templates',
      targetType: 'project',
      targetId: project.id,
      after: { templateIds },
    })
  })
}

// ---------------------------------------------------------------- resolving

interface Target {
  itemId: string | null
  stageId: string | null
  releaseId: string | null
}

/** Repeat sections start under the document's item only for item-level templates. */
async function resolveContext(
  ctx: ServiceContext,
  project: ProjectRow,
  target: Target,
  level: DocTemplateLevel,
): Promise<ResolveContext & { paths: Map<string, string> }> {
  const itemRows = await loadItems(ctx.db, project.id)
  const resolver = makeResolver(itemRows, [])
  const ordered = orderDepthFirst(itemRows)
  const paths = new Map(ordered.map((i) => [i.id, resolver.index.pathOf(i.id)]))
  const context: ResolveContext & { paths: Map<string, string> } = {
    items: ordered.map((i) => ({
      id: i.id,
      parentId: i.parentId,
      name: i.name,
      path: paths.get(i.id)!,
    })),
    rootItemId: level === 'item' ? target.itemId : null,
    paths,
  }
  if (target.releaseId) {
    const r = await getRelease(ctx, project.id, target.releaseId)
    const stageName = new Map(r.stages.map((s) => [s.id, s.name]))
    context.releaseItems = r.snapshot
      ? r.snapshot.items.map((i) => ({
          id: i.path,
          path: i.path,
          name: i.path.split(' > ').at(-1)!,
          kind: i.kind,
          stages: i.cells.map((c) => c.stage),
          note: i.note,
        }))
      : r.scope
          .filter((i) => i.kind)
          .map((i) => ({
            id: i.id,
            path: i.path,
            name: i.name,
            kind: i.kind!,
            stages: Object.keys(i.cells).map((s) => stageName.get(s)!),
            note: i.note,
          }))
  }
  return context
}

async function availableTemplate(
  ctx: ServiceContext,
  project: ProjectRow,
  ref: string,
): Promise<TemplateRow> {
  await ensureBuiltinTemplates(ctx.db, ctx.now())
  const t = await findTemplate(ctx.db, ref)
  if (t.archivedAt) throw conflict(`Template "${t.name}" is archived`)
  const selected = await ctx.db
    .select()
    .from(projectDocTemplates)
    .where(eq(projectDocTemplates.projectId, project.id))
  if (selected.length && !selected.some((s) => s.templateId === t.id))
    throw invalid(`Template "${t.name}" isn't enabled for this project`)
  return t
}

async function resolveTarget(
  ctx: ServiceContext,
  project: ProjectRow,
  level: DocTemplateLevel,
  input: { item?: string; stage?: string; release?: string },
): Promise<Target> {
  const [itemRows, stageRows] = await Promise.all([
    loadItems(ctx.db, project.id),
    loadStages(ctx.db, project.id),
  ])
  const resolver = makeResolver(itemRows, stageRows)
  const itemId = input.item ? resolver.item(input.item).id : null
  const stageId = input.stage ? resolver.stage(input.stage).id : null
  const releaseId = input.release ? (await getRelease(ctx, project.id, input.release)).id : null
  if (level === 'item' && !itemId) throw invalid('This template is for one item: give item')
  if (level === 'release' && !releaseId)
    throw invalid('This template is for a release: give release')
  if (stageId && !itemId) throw invalid('stage needs item (the document is linked to that cell)')
  return { itemId, stageId, releaseId }
}

/** Template with repeat sections expanded for this project/item/release (MCP get_doc_template). */
export async function resolveTemplateFor(
  ctx: ServiceContext,
  ref: string,
  templateRef: string,
  opts: { item?: string; release?: string } = {},
): Promise<ResolvedTemplate & { key: string; name: string; level: DocTemplateLevel }> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const t = await availableTemplate(ctx, project, templateRef)
  const target = await resolveTarget(ctx, project, 'project', {
    item: opts.item,
    release: opts.release,
  })
  if (t.level === 'release' && !target.releaseId)
    throw invalid('This template is for a release: give release')
  if (t.level === 'item' && !target.itemId)
    throw invalid('This template is for one item: give item')
  const resolved = resolveTemplate(
    t.schema as TemplateSchema,
    await resolveContext(ctx, project, target, t.level),
  )
  return { ...resolved, key: t.key, name: t.name, level: t.level }
}

// ---------------------------------------------------------------- documents

const viewUrl = (config: Pick<ServiceConfig, 'appUrl'>, project: ProjectRow, id: string) =>
  `${config.appUrl}/p/${project.slug}/docs/${id}`

async function findDocument(db: DbOrTx, projectId: string, id: string): Promise<DocumentRow> {
  if (!isUuid(id)) throw notFound('Document not found')
  const [d] = await db
    .select()
    .from(documents)
    .where(
      and(eq(documents.id, id), eq(documents.projectId, projectId), isNull(documents.deletedAt)),
    )
  if (!d) throw notFound('Document not found')
  return d
}

async function summaries(
  ctx: ServiceContext,
  project: ProjectRow,
  rows: DocumentRow[],
): Promise<DocumentSummaryDto[]> {
  if (rows.length === 0) return []
  const editorIds = [...new Set(rows.map((r) => r.updatedBy).filter((x): x is string => !!x))]
  const [itemRows, stageRows, templates, people] = await Promise.all([
    loadItems(ctx.db, project.id),
    loadStages(ctx.db, project.id, { includeArchived: true }),
    ctx.db
      .select()
      .from(docTemplates)
      .where(inArray(docTemplates.id, [...new Set(rows.map((r) => r.templateId))])),
    editorIds.length
      ? ctx.db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, editorIds))
      : Promise.resolve([]),
  ])
  const resolver = makeResolver(itemRows, [])
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]))
  const templateById = new Map(templates.map((t) => [t.id, t]))
  const personName = new Map(people.map((p) => [p.id, p.name]))
  const releaseNames = new Map<string, string>()
  for (const rid of new Set(rows.map((r) => r.releaseId).filter((x): x is string => !!x))) {
    releaseNames.set(rid, (await getRelease(ctx, project.id, rid)).name)
  }
  return rows.map((d) => {
    const t = templateById.get(d.templateId)!
    return {
      id: d.id,
      title: d.title,
      template: { id: t.id, key: t.key, name: t.name },
      item:
        d.itemId && itemRows.some((i) => i.id === d.itemId)
          ? { id: d.itemId, path: resolver.index.pathOf(d.itemId) }
          : null,
      stage: d.stageId ? { id: d.stageId, name: stageName.get(d.stageId) ?? '' } : null,
      release: d.releaseId ? { id: d.releaseId, name: releaseNames.get(d.releaseId) ?? '' } : null,
      version: d.version,
      updatedAt: d.updatedAt.toISOString(),
      updatedBy: (d.updatedBy && personName.get(d.updatedBy)) || 'System',
    }
  })
}

export async function listDocuments(
  ctx: ServiceContext,
  ref: string,
  filters: { template?: string; item?: string; release?: string } = {},
): Promise<DocumentSummaryDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const conds = [eq(documents.projectId, project.id), isNull(documents.deletedAt)]
  if (filters.template)
    conds.push(eq(documents.templateId, (await findTemplate(ctx.db, filters.template)).id))
  if (filters.item)
    conds.push(
      eq(
        documents.itemId,
        makeResolver(await loadItems(ctx.db, project.id), []).item(filters.item).id,
      ),
    )
  if (filters.release)
    conds.push(eq(documents.releaseId, (await getRelease(ctx, project.id, filters.release)).id))
  const rows = await ctx.db
    .select()
    .from(documents)
    .where(and(...conds))
    .orderBy(desc(documents.updatedAt))
  return summaries(ctx, project, rows)
}

export async function getDocument(
  ctx: ServiceContext,
  ref: string,
  id: string,
  version?: number,
): Promise<DocumentDto> {
  const { project, role } = await requireProjectRole(ctx, ref, 'viewer')
  const d = await findDocument(ctx.db, project.id, id)
  const [summary] = await summaries(ctx, project, [d])
  const revisions = await ctx.db
    .select({
      version: documentRevisions.version,
      createdAt: documentRevisions.createdAt,
      draft: documentRevisions.draft,
      title: documentRevisions.title,
      by: users.name,
    })
    .from(documentRevisions)
    .leftJoin(users, eq(users.id, documentRevisions.createdBy))
    .where(eq(documentRevisions.documentId, d.id))
    .orderBy(desc(documentRevisions.version))
  const chosen = version === undefined ? null : revisions.find((r) => r.version === version)
  if (version !== undefined && !chosen) throw notFound(`Version ${version} not found`)
  const snapshot = d.templateSnapshot as TemplateSchema
  const level = (await findTemplate(ctx.db, d.templateId)).level
  const resolved = resolveTemplate(snapshot, await resolveContext(ctx, project, d, level))
  return {
    ...summary!,
    title: chosen?.title ?? d.title,
    version: chosen?.version ?? d.version,
    template: { ...summary!.template, kind: snapshot.kind },
    resolved,
    draft: (chosen?.draft ?? d.draft) as Draft,
    revisions: revisions.map((r) => ({
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      by: r.by ?? 'System',
    })),
    project: { slug: project.slug, name: project.name, timezone: project.timezone, role },
    viewUrl: viewUrl(ctx.config, project, d.id),
  }
}

/**
 * Creates a document or a new version of one (spec 06 §7 save_doc_draft). With item+stage the
 * document is linked from that cell (kind "doc"). Does not change the cell's status.
 */
export async function saveDocDraft(
  ctx: ServiceContext,
  ref: string,
  input: SaveDocDraftInput,
): Promise<{ documentId: string; version: number; viewUrl: string }> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  const actor = requireActor(ctx)
  let existing: DocumentRow | null = null
  let template: TemplateRow
  let target: Target
  if (input.documentId) {
    existing = await findDocument(ctx.db, project.id, input.documentId)
    template = await findTemplate(ctx.db, existing.templateId)
    target = { itemId: existing.itemId, stageId: existing.stageId, releaseId: existing.releaseId }
  } else {
    template = await availableTemplate(ctx, project, input.template)
    target = await resolveTarget(ctx, project, template.level, input)
  }
  const snapshot = (existing?.templateSnapshot ?? template.schema) as TemplateSchema
  const context = await resolveContext(ctx, project, target, template.level)
  const resolved = resolveTemplate(snapshot, context)
  const problems = validateDraft(resolved, input.draft)
  if (problems.length)
    throw invalid(`The draft doesn't match the template: ${problems.join('; ')}`, { problems })

  return withTx(ctx, async (tx, txCtx) => {
    const now = ctx.now()
    const title =
      input.title ??
      existing?.title ??
      [template.name, target.itemId ? context.paths.get(target.itemId) : project.name]
        .filter(Boolean)
        .join(' – ')
    let id: string
    let version: number
    if (existing) {
      id = existing.id
      version = existing.version + 1
      await tx
        .update(documents)
        .set({ draft: input.draft, title, version, updatedBy: actor.userId, updatedAt: now })
        .where(eq(documents.id, id))
    } else {
      id = newId()
      version = 1
      await tx.insert(documents).values({
        id,
        projectId: project.id,
        itemId: target.itemId,
        stageId: target.stageId,
        releaseId: target.releaseId,
        templateId: template.id,
        templateSnapshot: snapshot,
        title,
        draft: input.draft,
        version,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      })
    }
    await tx.insert(documentRevisions).values({
      id: newId(),
      documentId: id,
      version,
      title,
      draft: input.draft,
      createdBy: actor.userId,
      createdAt: now,
    })
    const url = viewUrl(ctx.config, project, id)
    if (target.itemId && target.stageId) {
      const [cell] = await tx
        .select({ id: cells.id })
        .from(cells)
        .where(and(eq(cells.itemId, target.itemId), eq(cells.stageId, target.stageId)))
      if (cell) {
        const [link] = await tx
          .select()
          .from(cellLinks)
          .where(and(eq(cellLinks.documentId, id), isNull(cellLinks.deletedAt)))
        if (link) await tx.update(cellLinks).set({ title, url }).where(eq(cellLinks.id, link.id))
        else
          await tx.insert(cellLinks).values({
            id: newId(),
            cellId: cell.id,
            title,
            url,
            kind: 'doc',
            documentId: id,
            createdBy: actor.userId,
            createdAt: now,
          })
        await notify(tx, txCtx, project.id, 'cell.detail_updated', { cellId: cell.id })
      }
    }
    await audit(tx, txCtx, {
      projectId: project.id,
      action: existing ? 'doc.update' : 'doc.create',
      targetType: 'document',
      targetId: id,
      after: { title, version, template: template.key },
    })
    await notify(tx, txCtx, project.id, 'doc.updated', { documentId: id })
    return { documentId: id, version, viewUrl: url }
  })
}

export async function restoreRevision(
  ctx: ServiceContext,
  ref: string,
  id: string,
  version: number,
) {
  const doc = await getDocument(ctx, ref, id, version)
  return saveDocDraft(ctx, ref, {
    template: doc.template.id,
    draft: doc.draft,
    title: doc.title,
    documentId: id,
  })
}

export async function deleteDocument(ctx: ServiceContext, ref: string, id: string): Promise<void> {
  const { project } = await requireProjectRole(ctx, ref, 'editor')
  await withTx(ctx, async (tx, txCtx) => {
    const d = await findDocument(tx, project.id, id)
    const now = ctx.now()
    await tx.update(documents).set({ deletedAt: now }).where(eq(documents.id, d.id))
    await tx
      .update(cellLinks)
      .set({ deletedAt: now })
      .where(and(eq(cellLinks.documentId, d.id), isNull(cellLinks.deletedAt)))
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'doc.delete',
      targetType: 'document',
      targetId: d.id,
      before: { title: d.title },
    })
    await notify(tx, txCtx, project.id, 'doc.updated', { documentId: d.id })
  })
}

// ---------------------------------------------------------------- rendering

export type DocFormat = 'docx' | 'md' | 'confluence' | 'html'

export interface Rendered {
  filename: string
  contentType: string
  body: string | Uint8Array
  title: string
}

export async function renderDocument(
  ctx: ServiceContext,
  ref: string,
  id: string,
  format: DocFormat,
  version?: number,
): Promise<Rendered> {
  const doc = await getDocument(ctx, ref, id, version)
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  const d = await findDocument(ctx.db, project.id, id)
  const template = await findTemplate(ctx.db, d.templateId)
  const model = buildDocModel(doc.resolved as ResolvedTemplate, doc.draft, {
    title: doc.title,
    project: project.name,
    version: doc.version,
    date: zonedDate(new Date(doc.updatedAt), project.timezone),
    author: doc.updatedBy,
  })
  const date = zonedDate(ctx.now(), project.timezone)
  const base = `${project.slug}-${template.key}-v${doc.version}-${date}`
  if (format === 'docx') {
    return {
      filename: `${base}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: renderDocx(model, template.baseDocx ? new Uint8Array(template.baseDocx) : undefined),
      title: doc.title,
    }
  }
  if (format === 'md')
    return {
      filename: `${base}.md`,
      contentType: 'text/markdown; charset=utf-8',
      body: renderMarkdown(model),
      title: doc.title,
    }
  if (format === 'html')
    return {
      filename: `${base}.html`,
      contentType: 'text/html; charset=utf-8',
      body: renderHtml(model),
      title: doc.title,
    }
  const c = renderConfluence(model)
  return {
    filename: `${base}.xhtml`,
    contentType: 'application/xhtml+xml; charset=utf-8',
    body: c.body,
    title: c.title,
  }
}

// ---------------------------------------------------------------- signed download URLs

const SIGNED_TTL_MS = 15 * 60_000

function signature(secret: string, parts: (string | number)[]): string {
  return createHmac('sha256', secret).update(parts.join('|')).digest('base64url')
}

/** A 15-minute URL that downloads without a cookie (for AI clients to hand to the user). */
export async function signedDownloadUrl(
  ctx: ServiceContext,
  ref: string,
  id: string,
  format: 'docx' | 'md',
  version?: number,
) {
  const doc = await getDocument(ctx, ref, id, version)
  const exp = ctx.now().getTime() + SIGNED_TTL_MS
  const v = version ?? doc.version
  const sig = signature(ctx.config.appSecret, [id, format, v, exp])
  return {
    url: `${ctx.config.appUrl}/api/v1/documents/${id}/download?${new URLSearchParams({ format, v: String(v), exp: String(exp), sig })}`,
    expiresAt: new Date(exp).toISOString(),
  }
}

/** Checks a signed URL and renders as the document's creator would see it (no session needed). */
export async function renderSigned(
  ctx: Omit<ServiceContext, 'actor'>,
  id: string,
  q: { format?: string; v?: string; exp?: string; sig?: string },
): Promise<Rendered> {
  const format = q.format === 'md' ? 'md' : q.format === 'docx' ? 'docx' : null
  const v = Number(q.v)
  const exp = Number(q.exp)
  if (!format || !Number.isInteger(v) || !Number.isFinite(exp) || !q.sig)
    throw invalid('Bad download link')
  const expected = Buffer.from(signature(ctx.config.appSecret, [id, format, v, exp]))
  const given = Buffer.from(q.sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    throw new AppError('forbidden', 'This download link is invalid')
  if (exp < ctx.now().getTime())
    throw new AppError('forbidden', 'This download link has expired. Ask for a new one.')
  const [d] = await ctx.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
  if (!d) throw notFound('Document not found')
  const [creator] = await ctx.db.select().from(users).where(eq(users.id, d.createdBy!))
  const asCreator: ServiceContext = {
    ...ctx,
    actor: { userId: creator!.id, name: creator!.name, isAdmin: true, via: 'api' },
  }
  return renderDocument(asCreator, d.projectId, id, format, v)
}
