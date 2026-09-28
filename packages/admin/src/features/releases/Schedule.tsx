import type { ReleasePhaseDto } from '@stagegrid/shared'
import { addDays, daysBetween } from '@stagegrid/shared'
import { LockIcon } from 'lucide-react'

/** Horizontal schedule: phases as bars, a dashed "today" line, and a red target line (spec 07 §4). */
export function Schedule({
  phases,
  targetDate,
  today,
}: {
  phases: ReleasePhaseDto[]
  targetDate: string
  today: string
}) {
  const dates = [
    today,
    targetDate,
    ...phases.flatMap((p) => [p.plannedStart, p.plannedEnd]).filter((d): d is string => !!d),
  ]
  const start = addDays(
    dates.reduce((a, b) => (a < b ? a : b)),
    -3,
  )
  const end = addDays(
    dates.reduce((a, b) => (a > b ? a : b)),
    3,
  )
  const span = Math.max(1, daysBetween(start, end) + 1)
  const pct = (d: string) => `${(daysBetween(start, d) / span) * 100}%`
  const width = (a: string, b: string) => `${((daysBetween(a, b) + 1) / span) * 100}%`
  return (
    <div
      className="relative h-16 rounded-lg border"
      role="img"
      aria-label={`Schedule ending ${targetDate}`}
    >
      {phases
        .filter((p) => p.plannedStart && p.plannedEnd)
        .map((p) => (
          <div
            key={p.id}
            className="bg-primary/15 text-primary absolute top-2 flex h-6 items-center gap-1 overflow-hidden rounded px-1.5 text-xs whitespace-nowrap"
            style={{ left: pct(p.plannedStart!), width: width(p.plannedStart!, p.plannedEnd!) }}
            title={`${p.name}: ${p.plannedStart} → ${p.plannedEnd}`}
          >
            {p.freeze && <LockIcon className="size-3 shrink-0" aria-label="freeze" />}
            {p.name}
          </div>
        ))}
      <div
        className="border-muted-foreground absolute top-1 bottom-1 border-l border-dashed"
        style={{ left: pct(today) }}
      >
        <span className="text-muted-foreground absolute bottom-0 left-1 text-[10px]">Today</span>
      </div>
      <div
        className="border-destructive absolute top-1 bottom-1 border-l-2"
        style={{ left: pct(targetDate) }}
      >
        <span className="text-destructive absolute right-1 bottom-0 text-[10px] whitespace-nowrap">
          Go-live {targetDate}
        </span>
      </div>
    </div>
  )
}
