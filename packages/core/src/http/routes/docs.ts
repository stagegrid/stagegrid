import { docDraftInput, projectDocTemplatesInput, saveDocDraftInput } from '@stagegrid/shared'
import { type Context, Hono } from 'hono'
import { z } from 'zod'

import { invalid } from '../../errors'
import * as docs from '../../services/docs.service'
import { body, serviceCtx } from '../context'
import type { AppEnv } from '../env'

const levelSchema = z.enum(['project', 'item', 'release'])

async function uploadedFile(c: Context<AppEnv>): Promise<Uint8Array> {
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) throw invalid('Attach the .docx as form field "file"')
  return new Uint8Array(await file.arrayBuffer())
}

function send(c: Context<AppEnv>, r: docs.Rendered, inline = false) {
  c.header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${r.filename}"`)
  return c.body(typeof r.body === 'string' ? r.body : (r.body as Uint8Array<ArrayBuffer>), 200, {
    'Content-Type': r.contentType,
  })
}

const formatSchema = z.enum(['docx', 'md', 'confluence', 'html'])
const versionSchema = z.coerce.number().int().min(1).optional()

export const docRoutes = new Hono<AppEnv>()
  // ---- templates (admin)
  .get('/admin/templates', async (c) => c.json(await docs.listTemplates(serviceCtx(c))))
  .post('/admin/templates', async (c) => {
    const input = await body(
      c,
      z.object({
        key: z.string(),
        name: z.string().trim().min(1).max(100),
        level: levelSchema,
        schema: z.unknown(),
      }),
    )
    return c.json(await docs.createTemplate(serviceCtx(c), input), 201)
  })
  .post('/admin/templates/import-sections', async (c) =>
    c.json({ sections: docs.importSections(serviceCtx(c), await uploadedFile(c)) }),
  )
  .get('/admin/templates/:ref', async (c) =>
    c.json(await docs.getTemplate(serviceCtx(c), c.req.param('ref'))),
  )
  .patch('/admin/templates/:ref', async (c) => {
    const input = await body(
      c,
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        level: levelSchema.optional(),
        schema: z.unknown().optional(),
        archived: z.boolean().optional(),
      }),
    )
    return c.json(await docs.updateTemplate(serviceCtx(c), c.req.param('ref'), input))
  })
  .put('/admin/templates/:ref/base-docx', async (c) =>
    c.json(await docs.setBaseDocx(serviceCtx(c), c.req.param('ref'), await uploadedFile(c))),
  )
  .delete('/admin/templates/:ref/base-docx', async (c) =>
    c.json(await docs.setBaseDocx(serviceCtx(c), c.req.param('ref'), null)),
  )
  .get('/admin/templates/:ref/base-docx', async (c) => {
    const bytes = await docs.getBaseDocx(serviceCtx(c), c.req.param('ref'))
    if (!bytes) return c.body(null, 404)
    c.header('Content-Disposition', `attachment; filename="${c.req.param('ref')}-base.docx"`)
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
  })

  // ---- per project
  .get('/projects/:ref/doc-templates', async (c) =>
    c.json(
      await docs.projectTemplates(serviceCtx(c), c.req.param('ref'), {
        all: c.req.query('all') === 'true',
      }),
    ),
  )
  .put('/projects/:ref/doc-templates', async (c) => {
    const { templateIds } = await body(c, projectDocTemplatesInput)
    await docs.setProjectTemplates(serviceCtx(c), c.req.param('ref'), templateIds)
    return c.body(null, 204)
  })
  .get('/projects/:ref/doc-templates/:template/resolved', async (c) =>
    c.json(
      await docs.resolveTemplateFor(serviceCtx(c), c.req.param('ref'), c.req.param('template'), {
        item: c.req.query('item'),
        release: c.req.query('release'),
      }),
    ),
  )
  .get('/projects/:ref/documents', async (c) =>
    c.json(
      await docs.listDocuments(serviceCtx(c), c.req.param('ref'), {
        template: c.req.query('template'),
        item: c.req.query('item'),
        release: c.req.query('release'),
      }),
    ),
  )
  .post('/projects/:ref/documents', async (c) =>
    c.json(
      await docs.saveDocDraft(serviceCtx(c), c.req.param('ref'), await body(c, saveDocDraftInput)),
      201,
    ),
  )
  .get('/projects/:ref/documents/:id', async (c) =>
    c.json(
      await docs.getDocument(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        versionSchema.parse(c.req.query('v')),
      ),
    ),
  )
  .patch('/projects/:ref/documents/:id', async (c) => {
    const input = await body(
      c,
      z.object({ draft: docDraftInput, title: z.string().trim().min(1).max(200).optional() }),
    )
    const current = await docs.getDocument(serviceCtx(c), c.req.param('ref'), c.req.param('id'))
    return c.json(
      await docs.saveDocDraft(serviceCtx(c), c.req.param('ref'), {
        template: current.template.id,
        documentId: current.id,
        ...input,
      }),
    )
  })
  .delete('/projects/:ref/documents/:id', async (c) => {
    await docs.deleteDocument(serviceCtx(c), c.req.param('ref'), c.req.param('id'))
    return c.body(null, 204)
  })
  .post('/projects/:ref/documents/:id/revisions/:v/restore', async (c) =>
    c.json(
      await docs.restoreRevision(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        z.coerce.number().int().min(1).parse(c.req.param('v')),
      ),
    ),
  )
  .get('/projects/:ref/documents/:id/render', async (c) => {
    const format = formatSchema.parse(c.req.query('format') ?? 'md')
    const r = await docs.renderDocument(
      serviceCtx(c),
      c.req.param('ref'),
      c.req.param('id'),
      format,
      versionSchema.parse(c.req.query('v')),
    )
    return send(c, r, format === 'html')
  })
  // Signed link: works without a session (spec 06 §7).
  .get('/documents/:id/download', async (c) => {
    const deps = c.get('deps')
    const r = await docs.renderSigned(
      { db: deps.database.db, now: deps.now, config: deps.config },
      c.req.param('id'),
      c.req.query(),
    )
    return send(c, r)
  })
