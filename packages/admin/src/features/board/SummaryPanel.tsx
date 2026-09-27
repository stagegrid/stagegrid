import type { BoardDto } from '@stagegrid/shared'

import { ProgressBar } from '@/components/progress-bar'
import { cn } from '@/lib/utils'

function Ring({ percent }: { percent: number }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 120 120" className="size-32" role="img" aria-label={`${percent}% done`}>
      <circle cx="60" cy="60" r={r} className="stroke-muted fill-none" strokeWidth="10" />
      <circle
        cx="60"
        cy="60"
        r={r}
        className="stroke-primary fill-none transition-[stroke-dashoffset]"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - percent / 100)}
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="66" textAnchor="middle" className="fill-foreground text-[20px] font-semibold">
        {percent}%
      </text>
    </svg>
  )
}

export function SummaryPanel({
  board,
  onNeedsUpdate,
  className,
}: {
  board: BoardDto
  onNeedsUpdate: () => void
  className?: string
}) {
  const s = board.stats
  const cards = [
    ['All to do', s.all, ''],
    ['To do', s.open, 'text-status-todo'],
    ['Done', s.done, 'text-status-done'],
    ['Doing', s.doing, 'text-status-doing'],
  ] as const
  return (
    <aside
      className={cn('grid content-start gap-5 border-r p-5', className)}
      aria-label="Project summary"
    >
      <div className="flex justify-center">
        <Ring percent={s.percent} />
      </div>
      <dl className="grid grid-cols-2 gap-2">
        {cards.map(([label, n, color]) => (
          <div key={label} className="bg-muted/50 rounded-lg p-3 text-center">
            <dd className={cn('text-xl font-semibold tabular-nums', color)}>{n}</dd>
            <dt className="text-muted-foreground text-xs">{label}</dt>
          </div>
        ))}
      </dl>
      <div className="grid gap-2">
        <h2 className="text-muted-foreground text-xs font-medium uppercase">By stage</h2>
        {board.stages.map((stage) => {
          const st = s.byStage[stage.id]
          return (
            <div key={stage.id} className="grid gap-1">
              <div className="flex justify-between text-xs">
                <span className="truncate">{stage.name}</span>
                <span className="text-muted-foreground tabular-nums">{st?.percent ?? 0}%</span>
              </div>
              <ProgressBar percent={st?.percent ?? 0} />
            </div>
          )
        })}
      </div>
      <div className="flex gap-4 text-xs">
        <button
          type="button"
          onClick={onNeedsUpdate}
          className="text-status-stale hover:underline disabled:no-underline"
          disabled={s.stale === 0}
        >
          Needs update: {s.stale}
        </button>
        <span className="text-muted-foreground">Rework: {s.rework}</span>
      </div>
    </aside>
  )
}
