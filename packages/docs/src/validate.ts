import type { ResolvedTemplate } from './resolve'
import type { Draft } from './schema'

/** Problems with a draft against its resolved template; empty = valid (spec 06 §3.2). */
export function validateDraft(t: ResolvedTemplate, draft: Draft): string[] {
  const errors: string[] = []
  const sectionIds = new Set(t.sections.map((s) => s.id))
  for (const id of Object.keys(draft.sections ?? {}))
    if (!sectionIds.has(id)) errors.push(`Unknown section "${id}"`)
  const fields = new Map(t.fields.map((f) => [f.id, f]))
  for (const [id, value] of Object.entries(draft.fields ?? {})) {
    const f = fields.get(id)
    if (!f) {
      errors.push(`Unknown field "${id}"`)
      continue
    }
    const ok =
      f.type === 'list'
        ? Array.isArray(value) && value.every((v) => typeof v === 'string')
        : f.type === 'table'
          ? Array.isArray(value) &&
            value.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
          : typeof value === 'string'
    if (!ok)
      errors.push(
        `Field "${id}" must be ${f.type === 'list' ? 'a list of strings' : f.type === 'table' ? 'a list of rows' : 'a string'}`,
      )
    if (ok && f.type === 'date' && value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value as string))
      errors.push(`Field "${id}" must be YYYY-MM-DD`)
    if (ok && f.type === 'table') {
      const cols = new Set(f.columns!.map((c) => c.id))
      for (const row of value as Record<string, string>[])
        for (const k of Object.keys(row))
          if (!cols.has(k)) errors.push(`Field "${id}" has unknown column "${k}"`)
    }
  }
  return errors
}
