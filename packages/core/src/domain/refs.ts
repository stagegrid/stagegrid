import { PATH_SEPARATOR } from '@stagegrid/shared'

export interface RefItem {
  id: string
  parentId: string | null
  name: string
}

export type ResolveResult =
  | { ok: true; id: string }
  | { ok: false; code: 'not_found'; suggestions: string[] }
  | { ok: false; code: 'ambiguous_ref'; candidates: { id: string; path: string }[] }

const norm = (s: string) => s.trim().toLowerCase()
const splitPath = (ref: string) => ref.split(/\s+>\s+/).map(norm)

export interface PathIndex {
  pathOf(id: string): string
  resolve(ref: string): ResolveResult
}

/** Resolves item refs (id or " > "-separated path, case/space-insensitive per segment). Spec 04 §2. */
export function buildPathIndex(items: readonly RefItem[]): PathIndex {
  const byId = new Map(items.map((i) => [i.id, i]))
  const pathCache = new Map<string, string[]>()
  const segmentsOf = (id: string): string[] => {
    const cached = pathCache.get(id)
    if (cached) return cached
    const item = byId.get(id)
    if (!item) return []
    const parent = item.parentId && byId.has(item.parentId) ? segmentsOf(item.parentId) : []
    const segs = [...parent, item.name]
    pathCache.set(id, segs)
    return segs
  }
  const byNormPath = new Map<string, string[]>()
  for (const item of items) {
    const key = segmentsOf(item.id).map(norm).join('\u0000')
    const list = byNormPath.get(key) ?? []
    list.push(item.id)
    byNormPath.set(key, list)
  }
  const pathOf = (id: string) => segmentsOf(id).join(PATH_SEPARATOR)

  return {
    pathOf,
    resolve(ref: string): ResolveResult {
      if (byId.has(ref)) return { ok: true, id: ref }
      const segs = splitPath(ref)
      const matches = byNormPath.get(segs.join('\u0000')) ?? []
      if (matches.length === 1) return { ok: true, id: matches[0]! }
      if (matches.length > 1) {
        return {
          ok: false,
          code: 'ambiguous_ref',
          candidates: matches.map((id) => ({ id, path: pathOf(id) })),
        }
      }
      const last = segs.at(-1) ?? ''
      const suggestions = items
        .filter((i) => {
          const n = norm(i.name)
          return last !== '' && (n.includes(last) || last.includes(n))
        })
        .map((i) => pathOf(i.id))
        .sort((a, b) => a.length - b.length || a.localeCompare(b))
        .slice(0, 5)
      return { ok: false, code: 'not_found', suggestions }
    },
  }
}

export interface NamedRef {
  id: string
  name: string
}

/** Resolves a stage (or any flat named entity) by id or case-insensitive name. */
export function resolveByName(entries: readonly NamedRef[], ref: string): ResolveResult {
  if (entries.some((e) => e.id === ref)) return { ok: true, id: ref }
  const key = norm(ref)
  const matches = entries.filter((e) => norm(e.name) === key)
  if (matches.length === 1) return { ok: true, id: matches[0]!.id }
  if (matches.length > 1) {
    return {
      ok: false,
      code: 'ambiguous_ref',
      candidates: matches.map((e) => ({ id: e.id, path: e.name })),
    }
  }
  return {
    ok: false,
    code: 'not_found',
    suggestions: entries
      .filter((e) => norm(e.name).includes(key) || key.includes(norm(e.name)))
      .map((e) => e.name)
      .slice(0, 5),
  }
}
