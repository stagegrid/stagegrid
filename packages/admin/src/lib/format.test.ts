import { describe, expect, it } from 'vitest'

import { formatDateTime, initials, relativeTime } from './format'

describe('format', () => {
  it('relative time', () => {
    const now = new Date('2026-10-20T00:00:00Z')
    expect(relativeTime('2026-10-17T00:00:00Z', now)).toBe('3 days ago')
    expect(relativeTime('2026-10-20T00:00:20Z', now)).toBe('now')
  })
  it('formats in the project zone', () => {
    expect(formatDateTime('2026-10-01T20:00:00Z', 'Asia/Bangkok')).toContain('Oct 2, 2026')
  })
  it('initials handle Thai and single names', () => {
    expect(initials('Somchai Jaidee')).toBe('SJ')
    expect(initials('pond')).toBe('PO')
    expect(initials('สมชาย ใจดี')).toBe('สจ')
    expect(initials('เจน')).toBe('จน')
  })

  it('initials skip punctuation', () => {
    expect(initials('Somchai (QA)')).toBe('SQ')
    expect(initials('(QA)')).toBe('QA')
    expect(initials('- -')).toBe('?')
  })
})
