import { type CellStatus, type StaleReason, zonedDate } from '@stagegrid/shared'

export interface StaleInput {
  status: CellStatus
  statusChangedAt: Date | null
  plannedEnd: string | null
}

export interface StaleOptions {
  now: Date
  staleDays: number
  timeZone: string
}

const DAY_MS = 86_400_000

/** Spec 02 §7. `doing_too_long` wins when both apply. */
export function staleReason(cell: StaleInput, opts: StaleOptions): StaleReason | null {
  if (
    cell.status === 'doing' &&
    cell.statusChangedAt !== null &&
    cell.statusChangedAt.getTime() < opts.now.getTime() - opts.staleDays * DAY_MS
  ) {
    return 'doing_too_long'
  }
  if (
    cell.plannedEnd !== null &&
    cell.status !== 'done' &&
    cell.status !== 'skip' &&
    cell.plannedEnd < zonedDate(opts.now, opts.timeZone)
  ) {
    return 'past_planned_end'
  }
  return null
}
