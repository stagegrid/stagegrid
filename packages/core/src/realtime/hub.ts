import type { RealtimeEvent } from '@stagegrid/shared'

export interface SseClient {
  projectId: string
  userId: string
  send(event: RealtimeEvent): void
  close(): void
}

/** In-process fan-out of realtime events to SSE subscribers, keyed by project. */
export class SseHub {
  private readonly byProject = new Map<string, Set<SseClient>>()

  subscribe(client: SseClient): () => void {
    const set = this.byProject.get(client.projectId) ?? new Set()
    set.add(client)
    this.byProject.set(client.projectId, set)
    return () => {
      set.delete(client)
      if (set.size === 0) this.byProject.delete(client.projectId)
    }
  }

  publish(event: RealtimeEvent): void {
    const set = this.byProject.get(event.projectId)
    if (!set) return
    for (const client of [...set]) {
      if (event.type === 'member.removed' && event.userId === client.userId) {
        client.close()
        continue
      }
      client.send(event)
    }
  }

  /** Tells every client to refetch (used after the LISTEN connection was lost and may have missed events). */
  invalidateAll(at: Date = new Date()): void {
    for (const [projectId, set] of this.byProject) {
      for (const client of set) {
        client.send({
          type: 'board.invalidated',
          projectId,
          actor: { userId: null, name: 'System', via: 'system' },
          at: at.toISOString(),
        })
      }
    }
  }

  closeAll(): void {
    for (const set of this.byProject.values()) for (const client of set) client.close()
    this.byProject.clear()
  }

  get size(): number {
    let n = 0
    for (const set of this.byProject.values()) n += set.size
    return n
  }
}
