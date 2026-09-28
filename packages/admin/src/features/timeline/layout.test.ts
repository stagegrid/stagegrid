import { describe, expect, it } from 'vitest'

import { makeScale, monthStarts, plannedBar, roundBar, timelineRange } from './layout'

describe('timeline layout', () => {
  it('maps dates to pixels and bars cover whole days', () => {
    const s = makeScale('2026-10-01', 10)
    expect(s.x('2026-10-03')).toBe(20)
    expect(s.bar('2026-10-03', '2026-10-05')).toEqual({ left: 20, width: 30 })
    expect(s.bar('2026-10-05', '2026-10-03')).toEqual({ left: 20, width: 30 })
  })
  it('pads the range by a week', () => {
    expect(timelineRange('2026-10-10', '2026-10-20')).toEqual({
      start: '2026-10-03',
      end: '2026-10-27',
      days: 25,
    })
  })
  it('handles half-open plans and open rounds', () => {
    expect(plannedBar(null, '2026-10-10')).toEqual(['2026-10-10', '2026-10-10'])
    expect(plannedBar(null, null)).toBeNull()
    expect(roundBar('2026-10-01T20:00:00Z', null, 'Asia/Bangkok', '2026-10-05')).toEqual([
      '2026-10-02',
      '2026-10-05',
    ])
  })
  it('lists month starts inside the range', () => {
    expect(monthStarts('2026-09-15', '2026-12-01')).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ])
    expect(monthStarts('2026-10-01', '2026-10-20')).toEqual(['2026-10-01'])
  })
})
