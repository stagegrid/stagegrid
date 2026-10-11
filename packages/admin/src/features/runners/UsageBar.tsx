import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/** How much of an AI account's window is used, with the share employees are allowed to use marked. */
export function UsageBar({
  label,
  percent,
  ceiling,
  resetsAt,
}: {
  label: string
  percent: number | null
  ceiling: number
  resetsAt: string | null
}) {
  const known = percent !== null
  const over = known && percent >= ceiling
  return (
    <div className="grid gap-1 text-xs">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{label}</span>
        <span className={cn('text-muted-foreground', over && 'text-destructive')}>
          {known ? `${Math.round(percent)}% used` : 'No reading yet'} · employees up to {ceiling}%
        </span>
        {resetsAt && (
          <span className="text-muted-foreground ml-auto">resets {relativeTime(resetsAt)}</span>
        )}
      </div>
      <div
        role="meter"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(percent) : undefined}
        className="bg-muted relative h-2 overflow-hidden rounded-full"
      >
        {known && (
          <div
            className={cn('h-full rounded-full', over ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        )}
        <div
          aria-hidden
          className="bg-foreground/60 absolute inset-y-0 w-px"
          style={{ left: `${Math.min(100, ceiling)}%` }}
        />
      </div>
    </div>
  )
}
