import { RUN_LEASE_SECONDS, type RunState } from '@stagegrid/shared'

export interface RunLike {
  state: RunState
  resumeAt: Date | null
  leaseExpiresAt: Date | null
}

/** A run can be claimed when it is queued, or paused for capacity and the provider's limit has reset. */
export function isClaimable(run: RunLike, now: Date): boolean {
  if (run.state === 'queued') return true
  return (
    run.state === 'waiting_for_capacity' &&
    (run.resumeAt === null || run.resumeAt.getTime() <= now.getTime())
  )
}

export function leaseDeadline(now: Date): Date {
  return new Date(now.getTime() + RUN_LEASE_SECONDS * 1000)
}

export function isLeaseExpired(run: RunLike, now: Date): boolean {
  return (
    run.state === 'running' &&
    run.leaseExpiresAt !== null &&
    run.leaseExpiresAt.getTime() < now.getTime()
  )
}
