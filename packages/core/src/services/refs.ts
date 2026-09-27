import { buildPathIndex, type PathIndex, resolveByName, type ResolveResult } from '../domain/refs'
import { AppError } from '../errors'
import type { ItemRow, StageRow } from './structure'

export function refError(
  kind: 'item' | 'stage',
  ref: string,
  r: Exclude<ResolveResult, { ok: true }>,
): AppError {
  if (r.code === 'ambiguous_ref') {
    const list = r.candidates.map((c) => `"${c.path}"`).join(', ')
    return new AppError(
      'ambiguous_ref',
      `"${ref}" matches ${r.candidates.length} ${kind}s: ${list}. Use the full path or id.`,
      {
        ref,
        candidates: r.candidates,
      },
    )
  }
  const hint = r.suggestions.length
    ? ` Did you mean ${r.suggestions.map((s) => `"${s}"`).join(', ')}?`
    : ''
  return new AppError('not_found', `No ${kind} matches "${ref}".${hint}`, {
    ref,
    suggestions: r.suggestions,
  })
}

export interface Resolver {
  index: PathIndex
  item(ref: string): ItemRow
  stage(ref: string): StageRow
  tryItem(ref: string): ResolveResult
  tryStage(ref: string): ResolveResult
}

export function makeResolver(items: ItemRow[], stages: StageRow[]): Resolver {
  const index = buildPathIndex(items)
  const itemsById = new Map(items.map((i) => [i.id, i]))
  const stagesById = new Map(stages.map((s) => [s.id, s]))
  return {
    index,
    tryItem: (ref) => index.resolve(ref),
    tryStage: (ref) => resolveByName(stages, ref),
    item(ref) {
      const r = index.resolve(ref)
      if (!r.ok) throw refError('item', ref, r)
      return itemsById.get(r.id)!
    },
    stage(ref) {
      const r = resolveByName(stages, ref)
      if (!r.ok) throw refError('stage', ref, r)
      return stagesById.get(r.id)!
    },
  }
}
