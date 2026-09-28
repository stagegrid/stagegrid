import { AlertCircleIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <AlertCircleIcon className="text-destructive size-8" />
      <p className="text-sm">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      {body && <p className="text-muted-foreground max-w-sm text-sm">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}
