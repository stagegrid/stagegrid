import { describe, expect, it } from 'vitest'

import { hashPassword, hashToken, randomToken, verifyPassword } from './crypto'

describe('crypto', () => {
  it('creates prefixed random tokens', () => {
    const a = randomToken('sg_pat_')
    expect(a.startsWith('sg_pat_')).toBe(true)
    expect(a).not.toBe(randomToken('sg_pat_'))
    expect(a.length).toBeGreaterThan(40)
  })
  it('hashes tokens deterministically per secret', () => {
    expect(hashToken('s1', 't')).toBe(hashToken('s1', 't'))
    expect(hashToken('s1', 't')).not.toBe(hashToken('s2', 't'))
  })
  it('verifies passwords and rejects null hashes', async () => {
    const h = await hashPassword('correct horse')
    expect(await verifyPassword(h, 'correct horse')).toBe(true)
    expect(await verifyPassword(h, 'wrong')).toBe(false)
    expect(await verifyPassword(null, 'anything')).toBe(false)
  })
})
