import type { CellStatus } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { type CellEventLike, computeCellHistory, sortEvents, statusAt } from './rounds'

const day = (n: number) => new Date(Date.UTC(2026, 9, n))
let seq = 0
function ev(toStatus: CellStatus, happened: number, recordedOffsetMs = 0): CellEventLike {
  seq += 1
  return {
    id: `e${String(seq).padStart(3, '0')}`,
    toStatus,
    happenedAt: day(happened),
    recordedAt: new Date(day(happened).getTime() + recordedOffsetMs),
  }
}
const summary = (events: CellEventLike[]) => {
  const h = computeCellHistory(events)
  return {
    status: h.status,
    rework: h.reworkCount,
    rounds: h.rounds.map((r) => [
      r.startedAt.getUTCDate(),
      r.endedAt ? r.endedAt.getUTCDate() : null,
      r.outcome,
    ]),
  }
}

describe('computeCellHistory (spec 02 §4 table)', () => {
  it.each<[string, CellEventLike[], ReturnType<typeof summary>]>([
    [
      'doing, done',
      [ev('doing', 1), ev('done', 5)],
      { status: 'done', rework: 0, rounds: [[1, 5, 'done']] },
    ],
    [
      'two rounds after reopen',
      [ev('doing', 1), ev('done', 5), ev('doing', 12), ev('done', 14)],
      {
        status: 'done',
        rework: 1,
        rounds: [
          [1, 5, 'done'],
          [12, 14, 'done'],
        ],
      },
    ],
    ['straight to done', [ev('done', 3)], { status: 'done', rework: 0, rounds: [[3, 3, 'done']] }],
    [
      'stopped',
      [ev('doing', 1), ev('todo', 2)],
      { status: 'todo', rework: 0, rounds: [[1, 2, 'stopped']] },
    ],
    [
      'reopened to todo',
      [ev('doing', 1), ev('done', 5), ev('todo', 6)],
      { status: 'todo', rework: 1, rounds: [[1, 5, 'done']] },
    ],
    [
      'done then skip is not rework',
      [ev('doing', 1), ev('done', 5), ev('skip', 6)],
      { status: 'skip', rework: 0, rounds: [[1, 5, 'done']] },
    ],
    ['no events', [], { status: 'todo', rework: 0, rounds: [] }],
    ['open round', [ev('doing', 1)], { status: 'doing', rework: 0, rounds: [[1, null, null]] }],
    [
      'same status twice (backdated insert) is one round',
      [ev('doing', 2), ev('done', 9), ev('done', 27)],
      { status: 'done', rework: 0, rounds: [[2, 9, 'done']] },
    ],
  ])('%s', (_name, events, expected) => {
    expect(summary(events)).toEqual(expected)
  })

  it('orders by happenedAt even when inserted out of order (backdating)', () => {
    const done = ev('done', 5)
    const doing = ev('doing', 1)
    expect(summary([done, doing])).toEqual({ status: 'done', rework: 0, rounds: [[1, 5, 'done']] })
  })

  it('breaks happenedAt ties by recordedAt', () => {
    const first = ev('doing', 3, 0)
    const second = ev('done', 3, 60_000)
    expect(sortEvents([second, first]).map((e) => e.id)).toEqual([first.id, second.id])
    expect(computeCellHistory([second, first]).status).toBe('done')
  })

  it('reports from→to transitions in canonical order', () => {
    const h = computeCellHistory([ev('doing', 1), ev('done', 2)])
    expect(h.transitions.map((t) => `${t.fromStatus}>${t.toStatus}`)).toEqual([
      'todo>doing',
      'doing>done',
    ])
    expect(h.statusChangedAt?.getUTCDate()).toBe(2)
  })
})

describe('statusAt', () => {
  it('returns the status in effect at an instant', () => {
    const events = [ev('doing', 1), ev('done', 5)]
    expect(statusAt(events, day(0))).toBe('todo')
    expect(statusAt(events, day(3))).toBe('doing')
    expect(statusAt(events, day(5))).toBe('done')
  })
})
