import type { BoardDto, CellStatus } from '@stagegrid/shared'

import { buildPathIndex } from './refs'

const CODE: Record<CellStatus, string> = { skip: '-', todo: 'T', doing: 'P', done: 'D' }

export const COMPACT_LEGEND = {
  '-': 'skip (not needed)',
  T: 'todo (not started)',
  P: 'doing (in progress)',
  D: 'done',
  '*': 'suffix: needs update (stale)',
  '^n': 'suffix: reopened n times (rework)',
} as const

export interface CompactBoard {
  project: string
  stages: string[]
  legend: typeof COMPACT_LEGEND
  rows: string[]
  stats: Record<string, number>
}

/**
 * Token-cheap board for AI clients (spec 04 §6.2): one line per item, `Path | D D P T`.
 * `underItemId` limits rows to that item and its descendants.
 */
export function compactBoard(board: BoardDto, underItemId?: string): CompactBoard {
  const index = buildPathIndex(board.items)
  const prefix = underItemId ? index.pathOf(underItemId) : null
  const rows: string[] = []
  for (const item of board.items) {
    const path = index.pathOf(item.id)
    if (prefix && path !== prefix && !path.startsWith(`${prefix} > `)) continue
    const codes = board.stages.map((s) => {
      const c = board.cells[item.id]?.[s.id]
      if (!c) return '?'
      return `${CODE[c.status]}${c.rework > 0 ? `^${c.rework}` : ''}${c.stale ? '*' : ''}`
    })
    rows.push(`${path} | ${codes.join(' ')}`)
  }
  const { byStage: _byStage, ...stats } = board.stats
  return {
    project: board.project.slug,
    stages: board.stages.map((s) => s.name),
    legend: COMPACT_LEGEND,
    rows,
    stats,
  }
}
