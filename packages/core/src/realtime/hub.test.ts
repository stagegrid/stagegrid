import type { RealtimeEvent } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { SseHub } from './hub'

const actor = { userId: 'u', name: 'U', via: 'web' as const }
const ev = (
  projectId: string,
  type = 'cell.updated',
  extra: Record<string, unknown> = {},
): RealtimeEvent => ({
  type,
  projectId,
  actor,
  at: '2026-10-01T00:00:00Z',
  ...extra,
})

describe('SseHub', () => {
  it('delivers only to subscribers of the project and supports unsubscribe', () => {
    const hub = new SseHub()
    const a: string[] = []
    const b: string[] = []
    const offA = hub.subscribe({
      projectId: 'p1',
      userId: 'x',
      send: (e) => a.push(e.type),
      close: () => {},
    })
    hub.subscribe({ projectId: 'p2', userId: 'y', send: (e) => b.push(e.type), close: () => {} })
    hub.publish(ev('p1'))
    offA()
    hub.publish(ev('p1'))
    expect(a).toEqual(['cell.updated'])
    expect(b).toEqual([])
    expect(hub.size).toBe(1)
  })

  it('closes the stream of a removed member', () => {
    const hub = new SseHub()
    let closed = false
    const got: string[] = []
    hub.subscribe({ projectId: 'p1', userId: 'x', send: () => {}, close: () => (closed = true) })
    hub.subscribe({ projectId: 'p1', userId: 'y', send: (e) => got.push(e.type), close: () => {} })
    hub.publish(ev('p1', 'member.removed', { userId: 'x' }))
    expect(closed).toBe(true)
    expect(got).toEqual(['member.removed'])
  })

  it('invalidates everyone', () => {
    const hub = new SseHub()
    const got: string[] = []
    hub.subscribe({
      projectId: 'p1',
      userId: 'x',
      send: (e) => got.push(`${e.projectId}:${e.type}`),
      close: () => {},
    })
    hub.invalidateAll()
    expect(got).toEqual(['p1:board.invalidated'])
  })
})
