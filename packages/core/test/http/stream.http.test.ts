import pino from 'pino'
import { describe, expect, it } from 'vitest'

import { startListener } from '../../src/realtime/listener'
import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'
import { TEST_DATABASE_URL } from '../helpers/env'

const getDb = useTestDatabase()

async function readEvents(
  res: Response,
  count: number,
  timeoutMs = 3000,
): Promise<{ event: string; data: unknown }[]> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const out: { event: string; data: unknown }[] = []
  const deadline = Date.now() + timeoutMs
  while (out.length < count && Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) =>
        setTimeout(() => r({ value: undefined, done: true }), deadline - Date.now()),
      ),
    ])
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const event = /^event: (.*)$/m.exec(chunk)?.[1]
      const data = /^data: (.*)$/m.exec(chunk)?.[1]
      if (event && data) out.push({ event, data: JSON.parse(data) })
    }
  }
  await reader.cancel()
  return out
}

describe('SSE stream', () => {
  it('delivers committed changes from any connection via LISTEN/NOTIFY', async () => {
    const { app, deps } = makeApp(getDb())
    const stop = await startListener(TEST_DATABASE_URL, deps.hub, pino({ level: 'silent' }))
    try {
      const b = browser(app)
      await b.post('/api/v1/setup', SETUP_BODY)
      await b.post('/api/v1/projects', { name: 'Pilot' })
      await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Login' }] })
      const stream = await b.get('/api/v1/projects/pilot/stream')
      expect(stream.headers.get('content-type')).toBe('text/event-stream')
      const reading = readEvents(stream, 2)
      await new Promise((r) => setTimeout(r, 100))
      await b.post('/api/v1/projects/pilot/changes', {
        changes: [{ item: 'Login', stage: 'QA', status: 'doing' }],
      })
      const events = await reading
      expect(events[0]!.event).toBe('ready')
      expect(events[1]).toMatchObject({
        event: 'cell.updated',
        data: {
          itemPath: 'Login',
          stageName: 'QA',
          status: 'doing',
          actor: { name: 'Pond', via: 'web' },
        },
      })
    } finally {
      await stop()
    }
  })

  it('requires access to the project', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    expect((await browser(app).get('/api/v1/projects/pilot/stream')).status).toBe(401)
    expect((await b.get('/api/v1/projects/nope/stream')).status).toBe(404)
  })
})
