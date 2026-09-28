import { addDays, daysBetween, zonedDate } from '@stagegrid/shared'

export const ZOOM = { week: 28, month: 10, quarter: 4 } as const
export type Zoom = keyof typeof ZOOM

export interface Bar {
  left: number
  width: number
}

/** Horizontal geometry for a date range; each day is `pxPerDay` wide and a bar covers whole days. */
export function makeScale(from: string, pxPerDay: number) {
  const x = (date: string) => daysBetween(from, date) * pxPerDay
  return {
    x,
    bar(start: string, end: string): Bar {
      const [a, b] = start <= end ? [start, end] : [end, start]
      return { left: x(a), width: (daysBetween(a, b) + 1) * pxPerDay }
    },
  }
}

/** The visible window: data range padded by a week on both sides. */
export function timelineRange(
  from: string,
  to: string,
): { start: string; end: string; days: number } {
  const start = addDays(from, -7)
  const end = addDays(to, 7)
  return { start, end, days: daysBetween(start, end) + 1 }
}

/** Planned bar: when only one side is set, it is drawn as a single day. */
export function plannedBar(
  plannedStart: string | null,
  plannedEnd: string | null,
): [string, string] | null {
  if (!plannedStart && !plannedEnd) return null
  return [plannedStart ?? plannedEnd!, plannedEnd ?? plannedStart!]
}

/** A work round as dates in the project zone; an open round runs to today. */
export function roundBar(
  startedAt: string,
  endedAt: string | null,
  timeZone: string,
  today: string,
): [string, string] {
  return [
    zonedDate(new Date(startedAt), timeZone),
    endedAt ? zonedDate(new Date(endedAt), timeZone) : today,
  ]
}

/** First day of each month in [start, end], for header labels. */
export function monthStarts(start: string, end: string): string[] {
  const out: string[] = []
  let d = `${start.slice(0, 7)}-01`
  if (d < start) d = addDays(`${start.slice(0, 7)}-01`, 32).slice(0, 7) + '-01'
  while (d <= end) {
    out.push(d)
    d = addDays(d, 32).slice(0, 7) + '-01'
  }
  return out
}
