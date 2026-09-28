export interface RateLimiter {
  /** Counts a hit for `key`; returns seconds to wait when over the limit, else 0. */
  hit(key: string, now?: number): number
  reset(): void
}

/** Fixed-window, in-memory (per process) limiter. */
export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return {
    hit(key, now = Date.now()) {
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
      }
      let b = buckets.get(key)
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs }
        buckets.set(key, b)
      }
      b.count += 1
      return b.count > limit ? Math.ceil((b.resetAt - now) / 1000) : 0
    },
    reset: () => buckets.clear(),
  }
}
