import { cn } from '@/lib/utils'

export function ProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('bg-muted h-1.5 w-full overflow-hidden rounded-full', className)}
    >
      <div
        className="bg-primary h-full rounded-full transition-[width]"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}
