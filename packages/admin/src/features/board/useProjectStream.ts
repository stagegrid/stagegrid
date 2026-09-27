import type { BoardDto, RealtimeEvent, StaleReason } from '@stagegrid/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useMe } from '@/features/auth/queries'
import { qk } from '@/lib/query-keys'

import { useHighlights } from './highlight-store'

const STATUS_LABEL = { skip: 'Skip', todo: 'To do', doing: 'Doing', done: 'Done' } as const

interface CellUpdated extends RealtimeEvent {
  cellId: string
  itemId: string
  stageId: string
  status: keyof typeof STATUS_LABEL
  fromStatus: keyof typeof STATUS_LABEL
  rework: number
  stale: StaleReason | null
  itemPath: string
  stageName: string
}

const TOAST_WINDOW_MS = 2000
const TOAST_GROUP_AFTER = 3

/**
 * Subscribes to the project's SSE stream: patches the board cache for cell updates, refetches for
 * structural events, flashes changed cells, and toasts changes made by other people.
 */
export function useProjectStream(slug: string): { connected: boolean } {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const flash = useHighlights((s) => s.flash)
  const [connected, setConnected] = useState(true)
  const recent = useRef<number[]>([])

  useEffect(() => {
    const source = new EventSource(`/api/v1/projects/${encodeURIComponent(slug)}/stream`)
    let everOpened = false
    const refetchBoard = () => {
      void queryClient.invalidateQueries({ queryKey: qk.board(slug) })
      void queryClient.invalidateQueries({ queryKey: ['timeline', slug] })
      void queryClient.invalidateQueries({ queryKey: ['burnup', slug] })
    }

    const onCell = (msg: MessageEvent<string>) => {
      const e = JSON.parse(msg.data) as CellUpdated
      queryClient.setQueryData<BoardDto>(qk.board(slug), (b) => {
        if (!b?.cells[e.itemId]?.[e.stageId]) return b
        return {
          ...b,
          cells: {
            ...b.cells,
            [e.itemId]: {
              ...b.cells[e.itemId],
              [e.stageId]: {
                ...b.cells[e.itemId]![e.stageId]!,
                status: e.status,
                rework: e.rework,
                stale: e.stale,
              },
            },
          },
        }
      })
      // Stats and the cell's history change too; refresh them quietly.
      refetchBoard()
      void queryClient.invalidateQueries({ queryKey: qk.cell(slug, e.cellId) })
      if (e.actor.userId === me?.id && e.actor.via === 'web') return
      flash([e.cellId])
      const now = Date.now()
      recent.current = recent.current.filter((t) => now - t < TOAST_WINDOW_MS).concat(now)
      if (recent.current.length > TOAST_GROUP_AFTER) {
        toast(`${recent.current.length} cells updated`, { id: 'cells-batch', duration: 4000 })
      } else {
        toast(
          `${e.actor.name} via ${e.actor.via.toUpperCase()} · ${e.itemPath} › ${e.stageName} → ${STATUS_LABEL[e.status]}`,
          { duration: 4000 },
        )
      }
    }

    source.addEventListener('ready', () => {
      if (everOpened) refetchBoard()
      everOpened = true
      setConnected(true)
    })
    source.addEventListener('cell.updated', onCell)
    for (const type of [
      'item.created',
      'item.updated',
      'item.moved',
      'item.deleted',
      'stage.changed',
      'board.invalidated',
      'cell.detail_updated',
    ]) {
      source.addEventListener(type, refetchBoard)
    }
    source.addEventListener('project.updated', () => {
      refetchBoard()
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    })
    source.onerror = () => setConnected(false)
    return () => source.close()
  }, [slug, queryClient, me?.id, flash])

  return { connected }
}
