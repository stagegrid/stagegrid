import { describe, expect, it } from 'vitest'

import { capacityBlock, ceilingsFor, currentPercent } from './capacity'

const now = new Date('2026-10-20T03:00:00Z')
const later = '2026-10-20T05:00:00Z'
const earlier = '2026-10-20T01:00:00Z'
const cap = (fiveHour: number | null, weekly: number | null, resets = later) => ({
  fiveHour: fiveHour === null ? null : { percent: fiveHour, resetsAt: resets },
  weekly: weekly === null ? null : { percent: weekly, resetsAt: '2026-10-25T00:00:00Z' },
  reportedAt: now.toISOString(),
})

describe('ceilingsFor', () => {
  it('defaults to 80% of the five-hour window and 70% of the week', () => {
    expect(ceilingsFor({}, 'claude_code')).toEqual({ fiveHour: 80, weekly: 70 })
    expect(ceilingsFor({ codex: { fiveHour: 100, weekly: 100 } }, 'codex')).toEqual({
      fiveHour: 100,
      weekly: 100,
    })
  })
})

describe('currentPercent', () => {
  it('counts a window that already reset as empty', () => {
    expect(currentPercent({ percent: 95, resetsAt: earlier }, now)).toBe(0)
    expect(currentPercent({ percent: 95, resetsAt: later }, now)).toBe(95)
    expect(currentPercent(null, now)).toBe(0)
  })
})

describe('capacityBlock', () => {
  const defaults = { fiveHour: 80, weekly: 70 }
  it('has room below both ceilings, or when nothing was reported', () => {
    expect(capacityBlock(cap(34, 5), defaults, now)).toBeNull()
    expect(capacityBlock(undefined, defaults, now)).toBeNull()
    expect(capacityBlock(cap(null, null), defaults, now)).toBeNull()
  })
  it('blocks at the ceiling on either window and says which', () => {
    expect(capacityBlock(cap(80, 5), defaults, now)).toMatchObject({
      window: 'fiveHour',
      resetsAt: later,
    })
    expect(capacityBlock(cap(10, 59), defaults, now)).toBeNull()
    expect(capacityBlock(cap(10, 70), defaults, now)).toMatchObject({ window: 'weekly' })
  })
  it('lets a project that uses the account for AI only go to 100 percent', () => {
    expect(capacityBlock(cap(99, 99), { fiveHour: 100, weekly: 100 }, now)).toBeNull()
    expect(capacityBlock(cap(100, 5), { fiveHour: 100, weekly: 100 }, now)).not.toBeNull()
  })
  it('lets work start again once the window has reset', () => {
    expect(capacityBlock(cap(95, 5, earlier), defaults, now)).toBeNull()
  })
})
