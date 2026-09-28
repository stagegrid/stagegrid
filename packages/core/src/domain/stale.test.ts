import { describe, expect, it } from 'vitest'

import { staleReason } from './stale'

const opts = { now: new Date('2026-10-20T12:00:00Z'), staleDays: 7, timeZone: 'UTC' }

describe('staleReason', () => {
  it('flags doing older than staleDays', () => {
    expect(
      staleReason(
        { status: 'doing', statusChangedAt: new Date('2026-10-12T12:00:00Z'), plannedEnd: null },
        opts,
      ),
    ).toBe('doing_too_long')
    expect(
      staleReason(
        { status: 'doing', statusChangedAt: new Date('2026-10-14T12:00:00Z'), plannedEnd: null },
        opts,
      ),
    ).toBeNull()
  })
  it('flags past planned end unless done or skip', () => {
    const base = { statusChangedAt: null, plannedEnd: '2026-10-19' }
    expect(staleReason({ ...base, status: 'todo' }, opts)).toBe('past_planned_end')
    expect(staleReason({ ...base, status: 'done' }, opts)).toBeNull()
    expect(staleReason({ ...base, status: 'skip' }, opts)).toBeNull()
    expect(staleReason({ ...base, plannedEnd: '2026-10-20', status: 'todo' }, opts)).toBeNull()
  })
  it('uses the project time zone for "today"', () => {
    // 2026-10-20 20:00 UTC is 2026-10-21 in Bangkok, so a plan ending 10-20 is past due there only
    const late = { now: new Date('2026-10-20T20:00:00Z'), staleDays: 7 }
    const cell = { status: 'todo' as const, statusChangedAt: null, plannedEnd: '2026-10-20' }
    expect(staleReason(cell, { ...late, timeZone: 'UTC' })).toBeNull()
    expect(staleReason(cell, { ...late, timeZone: 'Asia/Bangkok' })).toBe('past_planned_end')
  })
  it('prefers doing_too_long when both apply', () => {
    expect(
      staleReason(
        {
          status: 'doing',
          statusChangedAt: new Date('2026-10-01T00:00:00Z'),
          plannedEnd: '2026-10-02',
        },
        opts,
      ),
    ).toBe('doing_too_long')
  })
})
