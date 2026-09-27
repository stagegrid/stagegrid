import { describe, expect, it } from 'vitest'

import { addDays, daysBetween, isValidTimeZone, zonedDate } from './time'

describe('zonedDate', () => {
  it('uses the zone, not UTC', () => {
    // 2026-10-01 20:00 UTC is already 2026-10-02 in Bangkok (UTC+7)
    const instant = new Date('2026-10-01T20:00:00Z')
    expect(zonedDate(instant, 'UTC')).toBe('2026-10-01')
    expect(zonedDate(instant, 'Asia/Bangkok')).toBe('2026-10-02')
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects garbage', () => {
    expect(isValidTimeZone('Asia/Bangkok')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
  })
})

describe('addDays / daysBetween', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-09-27', '2026-11-25')).toBe(59)
    expect(daysBetween('2026-11-25', '2026-09-27')).toBe(-59)
  })
})
