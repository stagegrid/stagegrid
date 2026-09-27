import type { Stats } from '@stagegrid/shared'

import { staleReason } from '../domain/stale'
import { computeStats } from '../domain/stats'
import type { CellRow } from './structure'

export interface ProjectSettingsForStats {
  staleDays: number
  timezone: string
}

export function cellStale(cell: CellRow, project: ProjectSettingsForStats, now: Date) {
  return staleReason(
    { status: cell.status, statusChangedAt: cell.statusChangedAt, plannedEnd: cell.plannedEnd },
    { now, staleDays: project.staleDays, timeZone: project.timezone },
  )
}

export function statsForCells(
  cells: CellRow[],
  project: ProjectSettingsForStats,
  now: Date,
): Stats {
  return computeStats(
    cells.map((c) => ({
      status: c.status,
      reworkCount: c.reworkCount,
      stale: cellStale(c, project, now) !== null,
    })),
  )
}
