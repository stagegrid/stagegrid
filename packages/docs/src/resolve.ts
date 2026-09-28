import type { TemplateField, TemplateSchema, TemplateSection } from './schema'

export interface ResolveItem {
  id: string
  parentId: string | null
  name: string
  path: string
}

export interface ResolveReleaseItem {
  id: string
  path: string
  name: string
  kind: 'new' | 'change'
  stages: string[]
  note: string | null
}

export interface ResolveContext {
  /** Project items in board order. */
  items: ResolveItem[]
  /** For item-level documents: the item the document is about. */
  rootItemId?: string | null
  /** For release-level documents. */
  releaseItems?: ResolveReleaseItem[]
}

export interface ResolvedSection {
  id: string
  /** Heading number such as "3.2", or null for non-numeric ids. */
  number: string | null
  title: string
  level: 1 | 2 | 3
  hint: string
}

export interface ResolvedTemplate {
  kind: TemplateSchema['kind']
  sections: ResolvedSection[]
  fields: TemplateField[]
}

const NUMERIC = /^\d+(\.\d+)*$/

function childrenAt(items: ResolveItem[], rootId: string | null, depth: 1 | 2): ResolveItem[] {
  const depthOf = new Map<string, number>()
  const out: ResolveItem[] = []
  for (const i of items) {
    const parentDepth = i.parentId === rootId ? 0 : i.parentId ? depthOf.get(i.parentId) : undefined
    if (parentDepth === undefined) continue
    const d = parentDepth + 1
    depthOf.set(i.id, d)
    if (d <= depth) out.push(i)
  }
  return out
}

/**
 * Expands `repeat` sections into one child section per item (spec 06 §3.1). Children get the
 * template section's level and hint plus the item's context; numbers continue the parent's.
 */
export function resolveTemplate(schema: TemplateSchema, ctx: ResolveContext): ResolvedTemplate {
  const sections: ResolvedSection[] = []
  const expand = (s: TemplateSection) => {
    const baseNumber = NUMERIC.test(s.id) ? s.id.replace(/\.x$/, '') : null
    if (!s.repeat) {
      sections.push({ id: s.id, number: baseNumber, title: s.title, level: s.level, hint: s.hint })
      return
    }
    const parent = baseNumber?.split('.').slice(0, -1).join('.') ?? null
    const start = baseNumber ? Number(baseNumber.split('.').at(-1)) : 1
    const children =
      s.repeat.source === 'items'
        ? childrenAt(ctx.items, ctx.rootItemId ?? null, s.repeat.depth).map((i) => ({
            id: i.id,
            title: i.name,
            extra: `Item: ${i.path}`,
          }))
        : (ctx.releaseItems ?? [])
            .filter(
              (r) =>
                !('kind' in s.repeat! && s.repeat.kind) ||
                r.kind === (s.repeat as { kind?: string }).kind,
            )
            .map((r) => ({
              id: r.id,
              title: r.name,
              extra: `Item: ${r.path} (${r.kind}), stages: ${r.stages.join(', ') || '—'}${r.note ? `, note: ${r.note}` : ''}`,
            }))
    children.forEach((c, i) => {
      const n = baseNumber ? [parent, String(start + i)].filter(Boolean).join('.') : null
      sections.push({
        id: `${s.id}/${c.id}`,
        number: n,
        title: c.title,
        level: s.level,
        hint: [s.hint, c.extra].filter(Boolean).join(' '),
      })
    })
  }
  for (const s of schema.sections ?? []) expand(s)
  return { kind: schema.kind, sections, fields: schema.kind === 'form' ? schema.fields : [] }
}
