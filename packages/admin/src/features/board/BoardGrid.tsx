import type { BoardDto } from '@stagegrid/shared'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FileTextIcon, MessageSquareIcon } from 'lucide-react'
import { type KeyboardEvent, useRef, useState } from 'react'
import { toast } from 'sonner'

import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

import { CellPopover, type OpenCell } from './CellPopover'
import { type DropPosition, dropPosition, moveRequest } from './drop-position'
import { useHighlights } from './highlight-store'
import { ItemName } from './ItemName'
import { useItemMutations } from './queries'
import { cellLabel, STATUS_META } from './status'
import type { VisibleRow } from './visible-rows'

const ROW_HEIGHT = 36
const DRAG_TYPE = 'text/x-stagegrid-item'

export function BoardGrid({
  board,
  rows,
  onToggle,
  onAddChild,
  nameWidth = 260,
  className,
}: {
  board: BoardDto
  rows: VisibleRow[]
  onToggle: (id: string) => void
  onAddChild: (item: { id: string; name: string }) => void
  nameWidth?: number
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<OpenCell | null>(null)
  const [drop, setDrop] = useState<{ id: string; pos: DropPosition } | null>(null)
  const highlights = useHighlights((s) => s.cells)
  const { move } = useItemMutations(board.project.slug)
  const canEdit = board.project.role !== 'viewer'
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })
  const columns = `${nameWidth}px repeat(${board.stages.length}, minmax(72px, 1fr))`

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = document.activeElement as HTMLElement | null
    const r = Number(el?.dataset.row)
    const c = Number(el?.dataset.col)
    if (Number.isNaN(r) || Number.isNaN(c)) return
    const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[
      e.key
    ]
    if (!delta) return
    e.preventDefault()
    const nr = Math.min(rows.length - 1, Math.max(0, r + delta[0]!))
    const nc = Math.min(board.stages.length - 1, Math.max(0, c + delta[1]!))
    virtualizer.scrollToIndex(nr)
    requestAnimationFrame(() =>
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-row="${nr}"][data-col="${nc}"]`)
        ?.focus(),
    )
  }

  const onDrop = async (targetId: string, pos: DropPosition, draggedId: string) => {
    setDrop(null)
    if (draggedId === targetId) return
    try {
      await move.mutateAsync({ id: draggedId, ...moveRequest(targetId, pos) })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div ref={scrollRef} className={cn('relative overflow-auto', className)} onKeyDown={onGridKey}>
      <div
        role="grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={board.stages.length + 1}
        style={{ minWidth: nameWidth + board.stages.length * 72 }}
      >
        <div
          role="row"
          className="bg-background sticky top-0 z-20 grid border-b"
          style={{ gridTemplateColumns: columns }}
        >
          <div
            role="columnheader"
            className="bg-background sticky left-0 z-10 px-3 py-2 text-xs font-medium"
          >
            Item
          </div>
          {board.stages.map((s) => (
            <div
              key={s.id}
              role="columnheader"
              className="text-muted-foreground truncate px-1 py-2 text-center text-xs font-medium"
              title={s.name}
            >
              {s.name}
            </div>
          ))}
        </div>
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index]!
            const target = drop?.id === row.item.id ? drop.pos : null
            return (
              <div
                key={row.item.id}
                role="row"
                aria-rowindex={v.index + 2}
                className={cn(
                  'hover:bg-muted/40 absolute inset-x-0 grid items-center border-b border-transparent',
                  target === 'inside' && 'bg-primary/10',
                  target === 'before' && 'border-t-primary border-t-2',
                  target === 'after' && 'border-b-primary border-b-2',
                )}
                style={{
                  gridTemplateColumns: columns,
                  height: v.size,
                  transform: `translateY(${v.start}px)`,
                }}
                onDragOver={(e) => {
                  if (!canEdit || !e.dataTransfer.types.includes(DRAG_TYPE)) return
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  setDrop({ id: row.item.id, pos: dropPosition(e.clientY - rect.top, rect.height) })
                }}
                onDragLeave={() => setDrop((d) => (d?.id === row.item.id ? null : d))}
                onDrop={(e) => {
                  e.preventDefault()
                  const dragged = e.dataTransfer.getData(DRAG_TYPE)
                  if (dragged && drop) void onDrop(row.item.id, drop.pos, dragged)
                }}
              >
                <div role="rowheader" className="bg-background sticky left-0 z-10 h-full px-2">
                  <ItemName
                    board={board}
                    row={row}
                    onToggle={() => onToggle(row.item.id)}
                    onAddChild={() => onAddChild(row.item)}
                    dragHandleProps={{
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.setData(DRAG_TYPE, row.item.id)
                        e.dataTransfer.effectAllowed = 'move'
                      },
                      onDragEnd: () => setDrop(null),
                    }}
                  />
                </div>
                {board.stages.map((stage, col) => {
                  const cell = board.cells[row.item.id]?.[stage.id]
                  if (!cell) return <div key={stage.id} role="gridcell" />
                  const isOpen = open?.cellId === cell.id
                  const button = (
                    <button
                      type="button"
                      data-row={v.index}
                      data-col={col}
                      tabIndex={v.index === 0 && col === 0 ? 0 : -1}
                      aria-label={cellLabel(
                        row.item.name,
                        stage.name,
                        cell.status,
                        cell.rework,
                        cell.stale !== null,
                      )}
                      title={cellLabel(
                        row.item.name,
                        stage.name,
                        cell.status,
                        cell.rework,
                        cell.stale !== null,
                      )}
                      onClick={() =>
                        setOpen({ cellId: cell.id, itemId: row.item.id, stageId: stage.id })
                      }
                      onKeyDown={(e) =>
                        e.key === 'Enter' &&
                        setOpen({ cellId: cell.id, itemId: row.item.id, stageId: stage.id })
                      }
                      className={cn(
                        'focus-visible:ring-ring relative mx-1 h-5 w-[calc(100%-0.5rem)] rounded-[4px] text-[10px] leading-5 font-semibold transition-shadow focus-visible:ring-2 focus-visible:outline-none',
                        STATUS_META[cell.status].cell,
                        STATUS_META[cell.status].text,
                        row.context && 'opacity-40',
                        highlights[cell.id] && 'ring-primary animate-pulse ring-2',
                      )}
                    >
                      {(cell.hasComments || cell.hasDocLink) && (
                        <span className="absolute inset-y-0 left-1 flex items-center gap-0.5 opacity-80">
                          {cell.hasDocLink && <FileTextIcon className="size-3" aria-hidden />}
                          {cell.hasComments && <MessageSquareIcon className="size-3" aria-hidden />}
                        </span>
                      )}
                      {cell.rework > 0 && (
                        <span className="absolute inset-y-0 right-1 flex items-center">
                          ×{cell.rework + 1}
                        </span>
                      )}
                      {cell.stale && (
                        <span className="bg-status-stale ring-background absolute -top-1 -right-1 size-2 rounded-full ring-2" />
                      )}
                    </button>
                  )
                  return (
                    <div key={stage.id} role="gridcell">
                      {isOpen ? (
                        <CellPopover
                          board={board}
                          open={open}
                          onClose={() => setOpen(null)}
                          anchor={button}
                        />
                      ) : (
                        button
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function Legend() {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
      {(['skip', 'todo', 'doing', 'done'] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-5 rounded-[3px]', STATUS_META[s].cell)} />
          {STATUS_META[s].label}
        </span>
      ))}
      <span>×N = worked N times</span>
      <span className="flex items-center gap-1.5">
        <span className="bg-status-stale size-2 rounded-full" />
        needs update
      </span>
    </div>
  )
}
