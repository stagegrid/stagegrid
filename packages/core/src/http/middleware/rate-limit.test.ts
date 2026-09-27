import { describe, expect, it } from 'vitest'

import { createRateLimiter } from './rate-limit'

describe('createRateLimiter', () => {
  it('allows `limit` hits per window then asks to wait', () => {
    const rl = createRateLimiter(2, 60_000)
    expect(rl.hit('a', 0)).toBe(0)
    expect(rl.hit('a', 1)).toBe(0)
    expect(rl.hit('a', 2)).toBe(60)
    expect(rl.hit('b', 2)).toBe(0)
    expect(rl.hit('a', 60_000)).toBe(0)
  })
})
