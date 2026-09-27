import type { CellStatus, Stats } from '@stagegrid/shared'

export interface StatsCell {
  status: CellStatus
  reworkCount: number
  stale: boolean
}

export function emptyStats(): Stats {
  return { all: 0, open: 0, doing: 0, done: 0, percent: 0, rework: 0, stale: 0 }
}

/** Spec 02 §7: `skip` cells are excluded from every counter; percent = done / all, 1 decimal. */
export function computeStats(cells: Iterable<StatsCell>): Stats {
  const s = emptyStats()
  for (const c of cells) {
    s.rework += c.reworkCount
    if (c.status === 'skip') continue
    s.all += 1
    if (c.stale) s.stale += 1
    if (c.status === 'done') s.done += 1
    else {
      s.open += 1
      if (c.status === 'doing') s.doing += 1
    }
  }
  s.percent = s.all === 0 ? 0 : Math.round((s.done / s.all) * 1000) / 10
  return s
}
