export interface TreeNode {
  id: string
  parentId: string | null
  position: string
}

/** Sort by fractional-index position (plain code-unit order), then id. Use for siblings and stages. */
export const byPosition = (
  a: { id: string; position: string },
  b: { id: string; position: string },
): number =>
  a.position < b.position
    ? -1
    : a.position > b.position
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0

const compareSiblings = byPosition

/** Depth-first order (siblings by position, then id). Nodes whose parent is missing are treated as roots. */
export function orderDepthFirst<T extends TreeNode>(
  nodes: readonly T[],
): (T & { depth: number })[] {
  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<string | null, T[]>()
  for (const n of nodes) {
    const key = n.parentId !== null && ids.has(n.parentId) ? n.parentId : null
    const list = children.get(key) ?? []
    list.push(n)
    children.set(key, list)
  }
  for (const list of children.values()) list.sort(compareSiblings)
  const out: (T & { depth: number })[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      out.push({ ...n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** Ids of all descendants of `id` (not including `id`). */
export function descendantIds(nodes: readonly TreeNode[], id: string): string[] {
  const byParent = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parentId === null) continue
    const list = byParent.get(n.parentId) ?? []
    list.push(n.id)
    byParent.set(n.parentId, list)
  }
  const out: string[] = []
  const stack = [...(byParent.get(id) ?? [])]
  while (stack.length) {
    const next = stack.pop()!
    out.push(next)
    stack.push(...(byParent.get(next) ?? []))
  }
  return out
}

/** True when making `newParentId` the parent of `id` would create a cycle. */
export function wouldCreateCycle(
  nodes: readonly TreeNode[],
  id: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false
  if (newParentId === id) return true
  return descendantIds(nodes, id).includes(newParentId)
}

/** Last sibling's position under `parentId`, or null when there are no siblings. */
export function lastChildPosition(
  nodes: readonly TreeNode[],
  parentId: string | null,
): string | null {
  let last: TreeNode | null = null
  for (const n of nodes) {
    if (n.parentId !== parentId) continue
    if (last === null || compareSiblings(n, last) > 0) last = n
  }
  return last?.position ?? null
}
