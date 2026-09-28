import { type Block, parseContent } from './content'
import type { ResolvedTemplate } from './resolve'
import type { Draft } from './schema'

export interface DocMeta {
  title: string
  project: string
  version: number
  /** YYYY-MM-DD in the project time zone. */
  date: string
  author: string
}

export type DocBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'fields'; rows: { label: string; value: Block[] }[] }
  | Block

export interface DocModel {
  meta: DocMeta
  blocks: DocBlock[]
}

const EMPTY: Block = { type: 'p', inlines: [{ type: 'text', value: '—' }] }
const text = (value: string): Block => ({ type: 'p', inlines: [{ type: 'text', value }] })

/** Template + draft → an ordered list of blocks all renderers share (so every format has the same structure). */
export function buildDocModel(t: ResolvedTemplate, draft: Draft, meta: DocMeta): DocModel {
  const out: DocBlock[] = []
  if (t.fields.length) {
    out.push({
      type: 'fields',
      rows: t.fields.map((f) => {
        const v = draft.fields?.[f.id]
        let value: Block[]
        if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) value = [EMPTY]
        else if (f.type === 'longtext') value = parseContent(String(v))
        else if (f.type === 'list')
          value = [{ type: 'list', ordered: false, items: (v as string[]).map((x) => [text(x)]) }]
        else if (f.type === 'table') {
          const cols = f.columns ?? []
          value = [
            {
              type: 'table',
              header: cols.map((c) => [{ type: 'text', value: c.label }]),
              rows: (v as Record<string, string>[]).map((row) =>
                cols.map((c) => [{ type: 'text', value: row[c.id] ?? '' }]),
              ),
            },
          ]
        } else value = [text(String(v))]
        return { label: f.label, value: value.length ? value : [EMPTY] }
      }),
    })
  }
  for (const s of t.sections) {
    out.push({
      type: 'heading',
      level: s.level,
      text: s.number ? `${s.number} ${s.title}` : s.title,
    })
    const content = draft.sections?.[s.id]?.trim()
    const parsed = content ? parseContent(content) : []
    out.push(...(parsed.length ? parsed : [EMPTY]))
  }
  return { meta, blocks: out }
}
