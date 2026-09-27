import type { BoardDto, BoardItemDto } from '@stagegrid/shared'

export interface BoardFilters {
  /** Hide rows whose own cells are all done/skip, unless a descendant still has work. */
  allToDo: boolean
  /** Show only rows with a stale cell (plus their ancestors). */
  needsUpdate: boolean
  /** Show only rows assigned to this person: a user id, or `name:<lowercased name>` for free-text names. */
  assignee?: string
  /** Show only these items (a release's scope) plus their ancestors. */
  items?: ReadonlySet<string>
}

export const assigneeKey = (a: { userId: string | null; name: string }): string =>
  a.userId ?? `name:${a.name.toLowerCase()}`

export interface VisibleRow {
  item: BoardItemDto
  hasChildren: boolean
  collapsed: boolean
  /** Shown only because a descendant matches the filters. */
  context: boolean
}

/**
 * Rows to render, in board order. `board.items` is already depth-first. A collapsed row hides its
 * descendants; filters keep a row when it matches or when any descendant matches (as context).
 */
export function visibleRows(
  board: BoardDto,
  collapsed: ReadonlySet<string>,
  filters: BoardFilters,
): VisibleRow[] {
  const items = board.items
  const childCount = new Map<string, number>()
  for (const i of items)
    if (i.parentId) childCount.set(i.parentId, (childCount.get(i.parentId) ?? 0) + 1)

  const matches = (i: BoardItemDto): boolean => {
    if (filters.items && !filters.items.has(i.id)) return false
    if (filters.assignee && !i.assignees.some((a) => assigneeKey(a) === filters.assignee))
      return false
    const cells = Object.values(board.cells[i.id] ?? {})
    if (filters.needsUpdate && !cells.some((c) => c.stale)) return false
    if (filters.allToDo && !cells.some((c) => c.status === 'todo' || c.status === 'doing'))
      return false
    return true
  }
  const filtering = filters.allToDo || filters.needsUpdate || !!filters.assignee || !!filters.items

  // subtreeMatch[i] = item i or any descendant matches. Walk backwards so children come first.
  const subtreeMatch = new Map<string, boolean>()
  for (let k = items.length - 1; k >= 0; k--) {
    const i = items[k]!
    const self = !filtering || matches(i)
    subtreeMatch.set(i.id, (subtreeMatch.get(i.id) ?? false) || self)
    if (i.parentId && subtreeMatch.get(i.id)) subtreeMatch.set(i.parentId, true)
  }

  const rows: VisibleRow[] = []
  let hideBelowDepth: number | null = null
  for (const item of items) {
    if (hideBelowDepth !== null) {
      if (item.depth > hideBelowDepth) continue
      hideBelowDepth = null
    }
    if (!subtreeMatch.get(item.id)) continue
    const isCollapsed = collapsed.has(item.id)
    rows.push({
      item,
      hasChildren: (childCount.get(item.id) ?? 0) > 0,
      collapsed: isCollapsed,
      context: filtering && !matches(item),
    })
    if (isCollapsed) hideBelowDepth = item.depth
  }
  return rows
}
