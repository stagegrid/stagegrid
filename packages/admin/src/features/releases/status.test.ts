import { describe, expect, it } from 'vitest'

import { untilTarget } from './status'

describe('untilTarget', () => {
  it('describes the distance to the target date', () => {
    expect(untilTarget('2026-09-27', '2026-11-25')).toBe('in 59 days')
    expect(untilTarget('2026-11-25', '2026-11-25')).toBe('today')
    expect(untilTarget('2026-11-28', '2026-11-25')).toBe('3 days late')
    expect(untilTarget('2026-11-26', '2026-11-25')).toBe('1 day late')
  })
})
