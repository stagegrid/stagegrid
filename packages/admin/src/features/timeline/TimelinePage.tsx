import type { TimelineDto, TimelineLaneDto } from '@stagegrid/shared'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'

import { ErrorState } from '@/components/page-state'
import { ProjectTabs } from '@/components/project-tabs'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CellPopover, type OpenCell } from '@/features/board/CellPopover'
import { boardQuery } from '@/features/board/queries'
import { STATUS_META } from '@/features/board/status'
import { useProjectStream } from '@/features/board/useProjectStream'
import { useRelease, useReleases } from '@/features/releases/queries'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { BurnupChart } from './BurnupChart'
import {
  makeScale,
  monthStarts,
  plannedBar,
  roundBar,
  timelineRange,
  ZOOM,
  type Zoom,
} from './layout'
import { useBurnup, useTimeline } from './queries'

const ROW = 28
const NONE = '__none__'
const NAME_WIDTH = 280

type Row =
  | { kind: 'item'; item: TimelineDto['items'][number] }
  | { kind: 'lane'; itemId: string; lane: TimelineLaneDto; stageName: string }

function rowsOf(t: TimelineDto): Row[] {
  const stageName = new Map(t.stages.map((s) => [s.id, s.name]))
  const rows: Row[] = []
  for (const item of t.items) {
    rows.push({ kind: 'item', item })
    for (const lane of item.lanes)
      rows.push({
        kind: 'lane',
        itemId: item.id,
        lane,
        stageName: stageName.get(lane.stageId) ?? '',
      })
  }
  return rows
}

export function TimelinePage({ slug }: { slug: string }) {
  const { data: t, error, isLoading, refetch } = useTimeline(slug)
  const { data: burnup } = useBurnup(slug)
  const { data: board } = useQuery(boardQuery(slug))
  useProjectStream(slug)
  const [zoom, setZoom] = useState<Zoom>('month')
  const [releaseId, setReleaseId] = useState<string>()
  const { data: activeReleases } = useReleases(slug, 'active')
  const { data: release } = useRelease(slug, releaseId)
  const [open, setOpen] = useState<{ cell: OpenCell; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => (t ? rowsOf(t) : []), [t])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW,
    overscan: 16,
  })

  if (isLoading) return <Skeleton className="m-6 h-96" />
  if (error || !t) return <ErrorState error={error} onRetry={() => void refetch()} />

  const px = ZOOM[zoom]
  const releaseDates = release
    ? [release.targetDate, ...release.phases.flatMap((p) => [p.plannedStart, p.plannedEnd])].filter(
        (d): d is string => !!d,
      )
    : []
  const from = [t.from, ...releaseDates].reduce((a, b) => (a < b ? a : b))
  const to = [t.to, ...releaseDates].reduce((a, b) => (a > b ? a : b))
  const range = timelineRange(from, to)
  const scale = makeScale(range.start, px)
  const width = range.days * px
  const tz = t.project.timezone
  const todayX = scale.x(t.today)
  const scrollToToday = () =>
    scrollRef.current?.scrollTo({ left: Math.max(0, todayX - 200), behavior: 'smooth' })

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <h1 className="truncate text-base font-semibold">{t.project.name}</h1>
        <ProjectTabs slug={slug} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {activeReleases && activeReleases.length > 0 && (
            <Select
              value={releaseId ?? NONE}
              onValueChange={(v) => setReleaseId(v === NONE ? undefined : v)}
            >
              <SelectTrigger size="sm" className="w-44 text-xs" aria-label="Show release">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No release</SelectItem>
                {activeReleases.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Release {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={zoom}
            onValueChange={(v) => v && setZoom(v as Zoom)}
            aria-label="Zoom"
          >
            <ToggleGroupItem value="week">Week</ToggleGroupItem>
            <ToggleGroupItem value="month">Month</ToggleGroupItem>
            <ToggleGroupItem value="quarter">Quarter</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" size="sm" onClick={scrollToToday}>
            Today
          </Button>
        </div>
      </div>
      {burnup && (
        <div className="border-b px-4 py-2">
          <h2 className="text-muted-foreground mb-1 text-xs font-medium uppercase">Burn-up</h2>
          {burnup.points.length > 1 ? (
            <BurnupChart data={burnup} />
          ) : (
            <p className="text-muted-foreground text-xs">
              The burn-up appears after a second day of activity.
            </p>
          )}
        </div>
      )}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        <div style={{ width: NAME_WIDTH + width }} className="relative">
          <div className="bg-background sticky top-0 z-20 flex h-8 border-b">
            <div
              className="bg-background sticky left-0 z-10 shrink-0 border-r px-3 text-xs leading-8 font-medium"
              style={{ width: NAME_WIDTH }}
            >
              Item › stage
            </div>
            <div className="relative" style={{ width }}>
              {monthStarts(range.start, range.end).map((m) => (
                <span
                  key={m}
                  className="text-muted-foreground absolute top-0 border-l pl-1 text-[11px] leading-8"
                  style={{ left: scale.x(m) }}
                >
                  {new Date(`${m}T00:00:00Z`).toLocaleDateString('en', {
                    month: 'short',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </span>
              ))}
            </div>
          </div>
          {release && (
            <div className="bg-background sticky top-8 z-20 flex h-8 border-b">
              <div
                className="bg-background sticky left-0 z-10 shrink-0 truncate border-r px-3 text-xs leading-8 font-medium"
                style={{ width: NAME_WIDTH }}
              >
                Release {release.name}
              </div>
              <div className="relative" style={{ width }}>
                {release.phases
                  .filter((p) => p.plannedStart && p.plannedEnd)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="bg-primary/15 text-primary absolute top-1.5 h-5 overflow-hidden rounded px-1 text-[11px] leading-5 whitespace-nowrap"
                      style={scale.bar(p.plannedStart!, p.plannedEnd!)}
                      title={`${p.name}: ${p.plannedStart} → ${p.plannedEnd}`}
                    >
                      {p.name}
                    </div>
                  ))}
                <div
                  className="border-destructive absolute top-0 bottom-0 border-l-2"
                  style={{ left: scale.x(release.targetDate) + px / 2 }}
                  title={`Go-live ${release.targetDate}`}
                />
              </div>
            </div>
          )}
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            <div
              className="bg-primary/60 pointer-events-none absolute top-0 bottom-0 z-10 w-px"
              style={{ left: NAME_WIDTH + todayX + px / 2 }}
              aria-hidden
            />
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]!
              return (
                <div
                  key={v.key}
                  className="absolute inset-x-0 flex border-b border-transparent"
                  style={{ height: ROW, transform: `translateY(${v.start}px)` }}
                >
                  {row.kind === 'item' ? (
                    <div
                      className="bg-background sticky left-0 z-10 shrink-0 truncate border-r px-3 text-sm leading-7 font-medium"
                      style={{ width: NAME_WIDTH, paddingLeft: 12 + row.item.depth * 16 }}
                      title={row.item.name}
                    >
                      {row.item.name}
                    </div>
                  ) : (
                    <>
                      <div
                        className="bg-background text-muted-foreground sticky left-0 z-10 shrink-0 truncate border-r px-3 text-xs leading-7"
                        style={{ width: NAME_WIDTH, paddingLeft: 28 }}
                      >
                        {row.stageName}
                      </div>
                      <LaneBars row={row} scale={scale} tz={tz} today={t.today} onOpen={setOpen} />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {board && open && (
        <CellPopover
          board={board}
          open={open.cell}
          onClose={() => setOpen(null)}
          anchor={<span className="fixed size-px" style={{ left: open.x, top: open.y }} />}
        />
      )}
    </div>
  )
}

function LaneBars({
  row,
  scale,
  tz,
  today,
  onOpen,
}: {
  row: Extract<Row, { kind: 'lane' }>
  scale: ReturnType<typeof makeScale>
  tz: string
  today: string
  onOpen: (o: { cell: OpenCell; x: number; y: number }) => void
}) {
  const { lane } = row
  const plan = plannedBar(lane.plannedStart, lane.plannedEnd)
  const open = (e: React.MouseEvent) =>
    onOpen({
      cell: { cellId: lane.cellId, itemId: row.itemId, stageId: lane.stageId },
      x: e.clientX,
      y: e.clientY + 8,
    })
  return (
    <div className="relative flex-1">
      {plan && (
        <button
          type="button"
          onClick={open}
          title={`Planned ${formatDate(`${plan[0]}T12:00:00Z`, 'UTC')} – ${formatDate(`${plan[1]}T12:00:00Z`, 'UTC')}${lane.overdue ? ' · overdue' : ''}`}
          aria-label={`${row.stageName} planned${lane.overdue ? ', overdue' : ''}`}
          className={cn(
            'bg-muted/60 absolute top-1 h-5 rounded border border-dashed',
            lane.overdue ? 'border-destructive' : 'border-muted-foreground/50',
          )}
          style={scale.bar(plan[0], plan[1])}
        />
      )}
      {lane.rounds.map((r) => {
        const [a, b] = roundBar(r.startedAt, r.endedAt, tz, today)
        const color =
          r.outcome === 'done'
            ? STATUS_META.done.cell
            : r.outcome === 'stopped'
              ? STATUS_META.skip.cell
              : STATUS_META.doing.cell
        return (
          <button
            key={r.roundNo}
            type="button"
            onClick={open}
            title={`Round ${r.roundNo}: ${formatDate(r.startedAt, tz)} → ${r.endedAt ? formatDate(r.endedAt, tz) : 'ongoing'}`}
            aria-label={`${row.stageName} round ${r.roundNo}`}
            className={cn(
              'absolute top-2 h-3 rounded-sm text-[9px] leading-3 font-semibold',
              color,
            )}
            style={scale.bar(a, b)}
          >
            {lane.rounds.length > 1 && <span className="px-0.5">R{r.roundNo}</span>}
          </button>
        )
      })}
    </div>
  )
}
