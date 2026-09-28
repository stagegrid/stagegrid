import { describe, expect, it } from 'vitest'

import { computeStats } from './stats'

describe('computeStats', () => {
  it('excludes skip and splits open/doing/done', () => {
    const cells = [
      { status: 'skip' as const, reworkCount: 0, stale: false },
      { status: 'todo' as const, reworkCount: 0, stale: false },
      { status: 'doing' as const, reworkCount: 1, stale: true },
      { status: 'done' as const, reworkCount: 2, stale: false },
    ]
    expect(computeStats(cells)).toEqual({
      all: 3,
      open: 2,
      doing: 1,
      done: 1,
      percent: 33.3,
      rework: 3,
      stale: 1,
    })
  })
  it('is zero for no cells', () => {
    expect(computeStats([]).percent).toBe(0)
  })
})
