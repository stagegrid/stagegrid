import { RUN_LEASE_SECONDS } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { isClaimable, isLeaseExpired, leaseDeadline } from './runs'

const now = new Date('2026-10-20T03:00:00Z')
const run = (state: Parameters<typeof isClaimable>[0]['state'], extra = {}) => ({
  state,
  resumeAt: null,
  leaseExpiresAt: null,
  ...extra,
})

describe('isClaimable', () => {
  it('claims queued runs only', () => {
    expect(isClaimable(run('queued'), now)).toBe(true)
    for (const s of ['running', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const)
      expect(isClaimable(run(s), now)).toBe(false)
  })
  it('claims a run paused for capacity only after the reset', () => {
    const later = new Date(now.getTime() + 60_000)
    expect(isClaimable(run('waiting_for_capacity', { resumeAt: later }), now)).toBe(false)
    expect(isClaimable(run('waiting_for_capacity', { resumeAt: later }), later)).toBe(true)
    expect(isClaimable(run('waiting_for_answer'), now)).toBe(false)
  })
})

describe('lease', () => {
  it('lasts the configured time and expires after it', () => {
    const deadline = leaseDeadline(now)
    expect(deadline.getTime() - now.getTime()).toBe(RUN_LEASE_SECONDS * 1000)
    expect(isLeaseExpired(run('running', { leaseExpiresAt: deadline }), now)).toBe(false)
    expect(
      isLeaseExpired(
        run('running', { leaseExpiresAt: deadline }),
        new Date(deadline.getTime() + 1),
      ),
    ).toBe(true)
  })
  it('only running runs hold a lease', () => {
    expect(isLeaseExpired(run('queued', { leaseExpiresAt: new Date(0) }), now)).toBe(false)
  })
})
