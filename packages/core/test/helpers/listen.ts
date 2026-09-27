import postgres from 'postgres'

import { CHANNEL } from '../../src/realtime/notify'
import { TEST_DATABASE_URL } from './env'

/** Collects realtime events published with pg_notify while `fn` runs. */
export async function captureEvents(
  fn: () => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  const client = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} })
  const got: Record<string, unknown>[] = []
  try {
    await client.listen(CHANNEL, (payload) =>
      got.push(JSON.parse(payload) as Record<string, unknown>),
    )
    await fn()
    await new Promise((r) => setTimeout(r, 150))
  } finally {
    await client.end({ timeout: 1 })
  }
  return got
}
