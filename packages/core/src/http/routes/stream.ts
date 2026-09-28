import type { RealtimeEvent } from '@stagegrid/shared'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { requireProjectRole } from '../../services/access'
import { serviceCtx } from '../context'
import type { AppEnv } from '../env'

const PING_MS = 25_000

export const streamRoutes = new Hono<AppEnv>().get('/projects/:ref/stream', async (c) => {
  const ctx = serviceCtx(c)
  const { project, actor } = await requireProjectRole(ctx, c.req.param('ref'), 'viewer')
  const hub = c.get('deps').hub
  c.header('X-Accel-Buffering', 'no')
  c.header('Cache-Control', 'no-cache')
  return streamSSE(c, async (stream) => {
    const queue: RealtimeEvent[] = []
    let wake: (() => void) | null = null
    let closed = false
    const stop = () => {
      closed = true
      wake?.()
    }
    const unsubscribe = hub.subscribe({
      projectId: project.id,
      userId: actor.userId,
      send: (e) => {
        queue.push(e)
        wake?.()
      },
      close: stop,
    })
    stream.onAbort(stop)
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ projectId: project.id }) })
    try {
      while (!closed) {
        while (queue.length) {
          const e = queue.shift()!
          await stream.writeSSE({ event: e.type, data: JSON.stringify(e) })
        }
        const ping = new Promise<void>((resolve) => {
          wake = resolve
          setTimeout(resolve, PING_MS)
        })
        await ping
        wake = null
        if (!closed && queue.length === 0) await stream.write(': ping\n\n')
      }
    } finally {
      unsubscribe()
    }
  })
})
