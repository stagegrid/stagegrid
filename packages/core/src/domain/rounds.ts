import type { CellStatus } from '@stagegrid/shared'

export interface CellEventLike {
  id: string
  toStatus: CellStatus
  happenedAt: Date
  recordedAt: Date
}

export type RoundOutcome = 'done' | 'stopped'

export interface Round {
  roundNo: number
  startedAt: Date
  endedAt: Date | null
  outcome: RoundOutcome | null
}

export interface Transition {
  eventId: string
  fromStatus: CellStatus
  toStatus: CellStatus
}

export interface CellHistory {
  status: CellStatus
  statusChangedAt: Date | null
  reworkCount: number
  rounds: Round[]
  transitions: Transition[]
}

/** Canonical order: happenedAt, then recordedAt, then id. Returns a new array. */
export function sortEvents<T extends CellEventLike>(events: readonly T[]): T[] {
  return [...events].sort(
    (a, b) =>
      a.happenedAt.getTime() - b.happenedAt.getTime() ||
      a.recordedAt.getTime() - b.recordedAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** Status in effect at instant `at` (events with happenedAt <= at count). */
export function statusAt(events: readonly CellEventLike[], at: Date): CellStatus {
  let status: CellStatus = 'todo'
  for (const e of sortEvents(events)) {
    if (e.happenedAt.getTime() > at.getTime()) break
    status = e.toStatus
  }
  return status
}

/** Derives current status, rework count, rounds, and from→to transitions from a cell's events. */
export function computeCellHistory(events: readonly CellEventLike[]): CellHistory {
  const sorted = sortEvents(events)
  let prev: CellStatus = 'todo'
  let open: { startedAt: Date } | null = null
  let rework = 0
  const closed: Omit<Round, 'roundNo'>[] = []
  const transitions: Transition[] = []

  for (const e of sorted) {
    const to = e.toStatus
    transitions.push({ eventId: e.id, fromStatus: prev, toStatus: to })
    // A backdated insert can put two events with the same status next to each other; the second changes nothing.
    if (to === prev) continue
    if (prev === 'done' && (to === 'todo' || to === 'doing')) rework += 1
    if (to === 'doing' && open === null) open = { startedAt: e.happenedAt }
    if (to === 'done') {
      closed.push({
        startedAt: open ? open.startedAt : e.happenedAt,
        endedAt: e.happenedAt,
        outcome: 'done',
      })
      open = null
    }
    if ((to === 'todo' || to === 'skip') && open) {
      closed.push({ startedAt: open.startedAt, endedAt: e.happenedAt, outcome: 'stopped' })
      open = null
    }
    prev = to
  }
  if (open) closed.push({ startedAt: open.startedAt, endedAt: null, outcome: null })

  const last = sorted.at(-1)
  return {
    status: prev,
    statusChangedAt: last ? last.happenedAt : null,
    reworkCount: rework,
    rounds: closed.map((r, i) => ({ ...r, roundNo: i + 1 })),
    transitions,
  }
}
