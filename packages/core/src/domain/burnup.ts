import { addDays, type CellStatus, daysBetween, zonedDate } from '@stagegrid/shared'

export interface BurnupCell {
  createdAt: Date
  /** Non-deleted events, any order. */
  events: { toStatus: CellStatus; happenedAt: Date; recordedAt: Date; id: string }[]
}

export interface BurnupPoint {
  date: string
  scope: number
  done: number
}

const MAX_DAILY_POINTS = 366

/**
 * Daily scope (non-skip cells that exist) and done counts, from the first day with data to `today`,
 * in the project's time zone (spec 02 §7). Longer ranges are sampled weekly (always ending on today).
 */
export function computeBurnup(cells: BurnupCell[], timeZone: string, today: string): BurnupPoint[] {
  if (cells.length === 0) return []
  const timelines = cells.map((c) => {
    const events = [...c.events]
      .sort(
        (a, b) =>
          a.happenedAt.getTime() - b.happenedAt.getTime() ||
          a.recordedAt.getTime() - b.recordedAt.getTime() ||
          (a.id < b.id ? -1 : 1),
      )
      .map((e) => ({ day: zonedDate(e.happenedAt, timeZone), toStatus: e.toStatus }))
    const firstEvent = events[0]?.day
    const created = zonedDate(c.createdAt, timeZone)
    return { start: firstEvent && firstEvent < created ? firstEvent : created, events }
  })
  const first = timelines.reduce((min, t) => (t.start < min ? t.start : min), today)
  const span = daysBetween(first, today)
  const step = span + 1 > MAX_DAILY_POINTS ? 7 : 1
  const days: string[] = []
  for (let d = today; d >= first; d = addDays(d, -step)) days.unshift(d)
  if (days[0] !== first && step === 1) days.unshift(first)

  return days.map((date) => {
    let scope = 0
    let done = 0
    for (const t of timelines) {
      if (t.start > date) continue
      let status: CellStatus = 'todo'
      for (const e of t.events) {
        if (e.day > date) break
        status = e.toStatus
      }
      if (status === 'skip') continue
      scope += 1
      if (status === 'done') done += 1
    }
    return { date, scope, done }
  })
}
