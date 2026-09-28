import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { docDraftInput } from '@stagegrid/shared'
import { z } from 'zod'

import type { ServiceContext } from '../../services/context'
import {
  getDocument,
  listDocuments,
  projectTemplates,
  renderDocument,
  resolveTemplateFor,
  saveDocDraft,
  signedDownloadUrl,
} from '../../services/docs.service'
import { run } from '../result'

const project = z.string().describe('Project slug (from list_projects) or id')
const RO = { readOnlyHint: true } as const

export function registerDocTools(server: McpServer, ctx: ServiceContext): void {
  server.registerTool(
    'list_doc_templates',
    {
      title: 'List document templates',
      description:
        "Document templates usable in this project (e.g. brd, srs, mom, release-notes, change-request, uat-signoff, test-summary, plus the organisation's own). level says what a document is about: project, item, or release.",
      inputSchema: { project },
      annotations: RO,
    },
    ({ project: ref }) =>
      run(async () =>
        (await projectTemplates(ctx, ref)).map((t) => ({
          key: t.key,
          name: t.name,
          kind: t.kind,
          level: t.level,
          sections: t.sectionCount,
        })),
      ),
  )

  server.registerTool(
    'get_doc_template',
    {
      title: 'Get document template',
      description:
        'The sections (and form fields) of a template for this project, with a hint for each saying what to write. Sections that repeat per item or per release item are already expanded (ids like "3.1/<itemId>"). Give item for item-level templates, release for release-level ones.',
      inputSchema: {
        project,
        template: z.string().describe('Template key, e.g. "srs"'),
        item: z.string().optional(),
        release: z.string().optional(),
      },
      annotations: RO,
    },
    ({ project: ref, template, item, release }) =>
      run(() => resolveTemplateFor(ctx, ref, template, { item, release })),
  )

  server.registerTool(
    'list_documents',
    {
      title: 'List documents',
      description: 'Documents written in this project, newest first.',
      inputSchema: {
        project,
        template: z.string().optional(),
        item: z.string().optional(),
        release: z.string().optional(),
      },
      annotations: RO,
    },
    ({ project: ref, ...filters }) => run(() => listDocuments(ctx, ref, filters)),
  )

  server.registerTool(
    'get_document',
    {
      title: 'Get document',
      description:
        'A document with its draft (section id → markdown, field id → value), resolved sections, and version history.',
      inputSchema: { project, documentId: z.uuid(), version: z.number().int().min(1).optional() },
      annotations: RO,
    },
    ({ project: ref, documentId, version }) =>
      run(() => getDocument(ctx, ref, documentId, version)),
  )

  server.registerTool(
    'save_doc_draft',
    {
      title: 'Save document draft',
      description: `Save a document written from a template. draft.sections maps section ids (from get_doc_template) to content in markdown — paragraphs, **bold**, *italic*, lists, tables, links; no headings (the template provides them). draft.fields maps form field ids to values (text/date strings, list = string array, table = array of {columnId: value}).
Give documentId to save a new version of an existing document. Give item + stage to link the document from that cell (e.g. item "Login", stage "Document"). Saving does not change any cell status — ask the user before using apply_changes.`,
      inputSchema: {
        project,
        template: z.string(),
        draft: docDraftInput,
        title: z.string().max(200).optional(),
        item: z.string().optional(),
        stage: z.string().optional(),
        release: z.string().optional(),
        documentId: z.uuid().optional(),
      },
    },
    ({ project: ref, ...input }) => run(() => saveDocDraft(ctx, ref, input)),
  )

  server.registerTool(
    'render_doc',
    {
      title: 'Render document',
      description:
        'Render a document as markdown, or as Confluence storage format ({title, body}). To publish to Confluence, pass body UNCHANGED to the Atlassian tool (createPage/updatePage, representation "storage") — do not rewrite it — then add the page URL to the cell with apply_changes link.',
      inputSchema: {
        project,
        documentId: z.uuid(),
        format: z.enum(['markdown', 'confluence']),
        version: z.number().int().min(1).optional(),
      },
      annotations: RO,
    },
    ({ project: ref, documentId, format, version }) =>
      run(async () => {
        const r = await renderDocument(
          ctx,
          ref,
          documentId,
          format === 'markdown' ? 'md' : 'confluence',
          version,
        )
        return format === 'markdown'
          ? { title: r.title, markdown: r.body }
          : { title: r.title, body: r.body }
      }),
  )

  server.registerTool(
    'get_doc_download_url',
    {
      title: 'Get download link',
      description:
        'A link (valid 15 minutes, no sign-in needed) to download the document as Word (.docx) or markdown. Give it to the user.',
      inputSchema: {
        project,
        documentId: z.uuid(),
        format: z.enum(['docx', 'markdown']),
        version: z.number().int().min(1).optional(),
      },
      annotations: RO,
    },
    ({ project: ref, documentId, format, version }) =>
      run(() =>
        signedDownloadUrl(ctx, ref, documentId, format === 'markdown' ? 'md' : 'docx', version),
      ),
  )
}
