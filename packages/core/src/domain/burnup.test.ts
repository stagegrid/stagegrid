import { describe, expect, it } from 'vitest'

import { type BurnupCell, computeBurnup } from './burnup'

let n = 0
const ev = (toStatus: 'skip' | 'todo' | 'doing' | 'done', iso: string) => {
  n += 1
  return { id: `e${n}`, toStatus, happenedAt: new Date(iso), recordedAt: new Date(iso) }
}
const cell = (created: string, events: ReturnType<typeof ev>[] = []): BurnupCell => ({
  createdAt: new Date(created),
  events,
})

describe('computeBurnup', () => {
  it('counts scope and done per day', () => {
    const points = computeBurnup(
      [
        cell('2026-10-01T02:00:00Z', [
          ev('doing', '2026-10-02T02:00:00Z'),
          ev('done', '2026-10-03T02:00:00Z'),
        ]),
        cell('2026-10-01T02:00:00Z', [ev('skip', '2026-10-02T02:00:00Z')]),
        cell('2026-10-03T02:00:00Z'),
      ],
      'UTC',
      '2026-10-04',
    )
    expect(points).toEqual([
      { date: '2026-10-01', scope: 2, done: 0 },
      { date: '2026-10-02', scope: 1, done: 0 },
      { date: '2026-10-03', scope: 2, done: 1 },
      { date: '2026-10-04', scope: 2, done: 1 },
    ])
  })

  it('starts at a backdated event before the cell existed', () => {
    const points = computeBurnup(
      [cell('2026-10-05T00:00:00Z', [ev('done', '2026-10-03T00:00:00Z')])],
      'UTC',
      '2026-10-05',
    )
    expect(points[0]).toEqual({ date: '2026-10-03', scope: 1, done: 1 })
  })

  it('uses the project time zone for day boundaries', () => {
    // 20:00 UTC on Oct 1 is Oct 2 in Bangkok
    const cells = [cell('2026-10-01T00:00:00Z', [ev('done', '2026-10-01T20:00:00Z')])]
    expect(computeBurnup(cells, 'UTC', '2026-10-02')).toEqual([
      { date: '2026-10-01', scope: 1, done: 1 },
      { date: '2026-10-02', scope: 1, done: 1 },
    ])
    expect(computeBurnup(cells, 'Asia/Bangkok', '2026-10-02')).toEqual([
      { date: '2026-10-01', scope: 1, done: 0 },
      { date: '2026-10-02', scope: 1, done: 1 },
    ])
  })

  it('samples weekly beyond a year, ending today', () => {
    const points = computeBurnup([cell('2024-01-01T00:00:00Z')], 'UTC', '2026-10-01')
    expect(points.at(-1)!.date).toBe('2026-10-01')
    expect(points.length).toBeLessThan(150)
    expect(points[1]!.date > points[0]!.date).toBe(true)
  })

  it('is empty with no cells', () => {
    expect(computeBurnup([], 'UTC', '2026-10-01')).toEqual([])
  })
})
