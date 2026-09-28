import type { BoardDto, CellStatus } from '@stagegrid/shared'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { formatDate, formatDateTime, relativeTime, toLocalInput } from '@/lib/format'
import { cn } from '@/lib/utils'

import { cellQuery, useApplyChanges } from './queries'
import { STATUS_META, STATUS_ORDER } from './status'

export interface OpenCell {
  cellId: string
  itemId: string
  stageId: string
}

const HOUR_MS = 3_600_000

export function CellPopover({
  board,
  open,
  onClose,
  anchor,
}: {
  board: BoardDto
  open: OpenCell | null
  onClose: () => void
  anchor: ReactNode
}) {
  return (
    <Popover open={open !== null} onOpenChange={(o) => !o && onClose()}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      {open && (
        <PopoverContent
          className="max-h-(--radix-popover-content-available-height) w-96 overflow-y-auto p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <CellEditor key={open.cellId} board={board} open={open} onDone={onClose} />
        </PopoverContent>
      )}
    </Popover>
  )
}

function CellEditor({
  board,
  open,
  onDone,
}: {
  board: BoardDto
  open: OpenCell
  onDone: () => void
}) {
  const slug = board.project.slug
  const canEdit = board.project.role !== 'viewer'
  const { data: detail, isLoading } = useQuery(cellQuery(slug, open.cellId))
  const current = board.cells[open.itemId]?.[open.stageId]
  const [picked, setPicked] = useState<CellStatus | null>(null)
  const [when, setWhen] = useState(() => toLocalInput(new Date()))
  const [reason, setReason] = useState('')
  const apply = useApplyChanges(slug)
  const item = board.items.find((i) => i.id === open.itemId)
  const stage = board.stages.find((s) => s.id === open.stageId)

  const save = async (status: CellStatus) => {
    const happened = new Date(when)
    try {
      const res = await apply.mutateAsync([
        {
          item: open.itemId,
          stage: open.stageId,
          status,
          ...(Math.abs(happened.getTime() - Date.now()) > 60_000
            ? { happenedAt: happened.toISOString() }
            : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      ])
      if (res.results[0]?.backdatedBeforeLaterEvent) {
        toast("Saved to history. The current status didn't change because a later update exists.")
      }
      onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  useEffect(() => {
    if (!canEdit) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && picked) void save(picked)
        return
      }
      const s = STATUS_ORDER.find((x) => STATUS_META[x].key === e.key)
      if (s) setPicked(s)
      if (e.key === 'Enter' && picked) void save(picked)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tz = board.project.timezone
  return (
    <div className="grid gap-3 p-4">
      <div>
        <p className="text-muted-foreground truncate text-xs">{detail?.itemPath ?? item?.name}</p>
        <p className="text-sm font-medium">{stage?.name}</p>
      </div>
      {canEdit ? (
        <>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Status">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={(picked ?? current?.status) === s}
                onClick={() => setPicked(s)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium ring-offset-2 transition',
                  STATUS_META[s].cell,
                  STATUS_META[s].text,
                  (picked ?? current?.status) === s
                    ? 'ring-ring ring-offset-background ring-2'
                    : 'opacity-70 hover:opacity-100',
                )}
              >
                {STATUS_META[s].label}
                <span className="ml-1 opacity-60">{STATUS_META[s].key}</span>
              </button>
            ))}
          </div>
          {picked && picked !== current?.status && (
            <div className="grid gap-2">
              <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                <Label htmlFor="cell-when" className="text-xs">
                  When
                </Label>
                <Input
                  id="cell-when"
                  type="datetime-local"
                  value={when}
                  max={toLocalInput(new Date())}
                  onChange={(e) => setWhen(e.target.value)}
                  className="h-8"
                />
                <Label htmlFor="cell-reason" className="text-xs">
                  Reason
                </Label>
                <Input
                  id="cell-reason"
                  placeholder="Optional"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-8"
                  maxLength={1000}
                />
              </div>
              <Button size="sm" onClick={() => void save(picked)} disabled={apply.isPending}>
                Save
              </Button>
            </div>
          )}
        </>
      ) : (
        current && (
          <Badge className={cn(STATUS_META[current.status].cell, STATUS_META[current.status].text)}>
            {STATUS_META[current.status].label}
          </Badge>
        )
      )}

      <div className="grid gap-2 border-t pt-3">
        <h3 className="text-muted-foreground text-xs font-medium uppercase">History</h3>
        {isLoading && <Skeleton className="h-12" />}
        {detail?.rounds.length ? (
          <ul className="text-xs">
            {detail.rounds.map((r) => (
              <li key={r.roundNo}>
                Round {r.roundNo} · {formatDate(r.startedAt, tz)} →{' '}
                {r.endedAt ? formatDate(r.endedAt, tz) : 'ongoing'}
                {r.outcome === 'stopped' && (
                  <span className="text-muted-foreground"> (stopped)</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {detail && detail.events.length === 0 && (
          <p className="text-muted-foreground text-xs">No changes yet.</p>
        )}
        <ul className="grid max-h-48 gap-2 overflow-y-auto">
          {detail?.events.map((e) => {
            const late =
              new Date(e.recordedAt).getTime() - new Date(e.happenedAt).getTime() > HOUR_MS
            return (
              <li key={e.id} className="grid gap-0.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', STATUS_META[e.toStatus].cell)} />
                  <span>
                    {STATUS_META[e.fromStatus].label} → {STATUS_META[e.toStatus].label}
                  </span>
                  <span
                    className="text-muted-foreground ml-auto"
                    title={formatDateTime(e.happenedAt, tz)}
                  >
                    {relativeTime(e.happenedAt)}
                  </span>
                </div>
                <div className="text-muted-foreground flex gap-1.5">
                  <span>{e.actor.name}</span>
                  <Badge variant="outline" className="h-4 px-1 text-[10px] uppercase">
                    {e.actor.via}
                  </Badge>
                  {late && (
                    <span>
                      recorded{' '}
                      {relativeTime(e.recordedAt, new Date(e.happenedAt)).replace('in ', '')} later
                    </span>
                  )}
                </div>
                {e.reason && <p className="text-muted-foreground italic">“{e.reason}”</p>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
