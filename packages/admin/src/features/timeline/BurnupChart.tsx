import type { BurnupDto } from '@stagegrid/shared'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'

const config = {
  scope: { label: 'Scope', color: 'var(--muted-foreground)' },
  done: { label: 'Done', color: 'var(--status-done)' },
} satisfies ChartConfig

const short = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

/** Scope vs done over time (spec 03 §9). */
export function BurnupChart({ data, className }: { data: BurnupDto; className?: string }) {
  if (data.points.length === 0) return null
  return (
    <ChartContainer config={config} className={cn('aspect-auto h-44 w-full', className)}>
      <AreaChart data={data.points} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={short}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis width={32} tickLine={false} axisLine={false} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => short(String(v))} />} />
        <Area
          dataKey="scope"
          type="stepAfter"
          stroke="var(--color-scope)"
          fill="var(--color-scope)"
          fillOpacity={0.08}
          isAnimationActive={false}
        />
        <Area
          dataKey="done"
          type="stepAfter"
          stroke="var(--color-done)"
          fill="var(--color-done)"
          fillOpacity={0.25}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

/** Tiny two-line version for the board summary panel. */
export function BurnupSparkline({ data }: { data: BurnupDto }) {
  const pts = data.points
  if (pts.length < 2) return null
  const max = Math.max(...pts.map((p) => p.scope), 1)
  const path = (key: 'scope' | 'done') =>
    pts
      .map(
        (p, i) =>
          `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * 100).toFixed(2)},${(40 - (p[key] / max) * 38).toFixed(2)}`,
      )
      .join(' ')
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="h-12 w-full"
      role="img"
      aria-label="Burn-up: scope and done over time"
    >
      <path
        d={path('scope')}
        className="stroke-muted-foreground fill-none"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path('done')}
        className="stroke-status-done fill-none"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
