import type { ReleaseDisplayStatus } from '@stagegrid/shared'
import { daysBetween } from '@stagegrid/shared'

export const RELEASE_BADGE: Record<ReleaseDisplayStatus, { label: string; className: string }> = {
  planned: { label: 'Planned', className: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'In progress', className: 'bg-primary/15 text-primary' },
  at_risk: { label: 'At risk', className: 'bg-status-doing/20 text-status-doing' },
  released: { label: 'Released', className: 'bg-status-done/20 text-status-done' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground line-through' },
}

/** "in 59 days", "today", "3 days late". */
export function untilTarget(today: string, target: string): string {
  const d = daysBetween(today, target)
  if (d === 0) return 'today'
  if (d > 0) return `in ${d} day${d === 1 ? '' : 's'}`
  return `${-d} day${d === -1 ? '' : 's'} late`
}
