import { buildDocModel, renderConfluence, renderHtml, type ResolvedTemplate } from '@stagegrid/docs'
import type { DocumentDto } from '@stagegrid/shared'

/** Same renderer as the server (shared package), so the preview matches the downloads. */
export function documentModel(doc: DocumentDto) {
  return buildDocModel(doc.resolved as ResolvedTemplate, doc.draft, {
    title: doc.title,
    project: doc.project.name,
    version: doc.version,
    date: new Intl.DateTimeFormat('en-CA', { timeZone: doc.project.timezone }).format(
      new Date(doc.updatedAt),
    ),
    author: doc.updatedBy,
  })
}

export const documentHtml = (doc: DocumentDto) => renderHtml(documentModel(doc))
export const documentConfluence = (doc: DocumentDto) => renderConfluence(documentModel(doc))
