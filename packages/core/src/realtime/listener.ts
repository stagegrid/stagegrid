import type { RealtimeEvent } from '@stagegrid/shared'
import type { Logger } from 'pino'
import postgres from 'postgres'

import type { SseHub } from './hub'
import { CHANNEL } from './notify'

/**
 * Keeps one LISTEN connection per process and forwards events to the hub. postgres.js reconnects
 * automatically; every reconnect after the first triggers `invalidateAll` since events may be lost.
 */
export async function startListener(
  databaseUrl: string,
  hub: SseHub,
  logger: Logger,
): Promise<() => Promise<void>> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  let connectedOnce = false
  await client.listen(
    CHANNEL,
    (payload) => {
      try {
        hub.publish(JSON.parse(payload) as RealtimeEvent)
      } catch (err) {
        logger.warn({ err }, 'bad realtime payload')
      }
    },
    () => {
      if (connectedOnce) {
        logger.warn('realtime listener reconnected; invalidating clients')
        hub.invalidateAll()
      }
      connectedOnce = true
    },
  )
  return () => client.end({ timeout: 2 })
}
