import type { ThreadItemDto } from '@stagegrid/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { threadQuery } from './queries'

function Item({ item, timezone }: { item: ThreadItemDto; timezone: string }) {
  const emphasis = item.kind === 'question' || item.kind === 'answer'
  return (
    <li className="grid gap-0.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{item.actor.name}</span>
        {item.actor.isEmployee && (
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            AI
          </Badge>
        )}
        {item.kind === 'question' && <span className="text-muted-foreground">asked</span>}
        {item.kind === 'answer' && <span className="text-muted-foreground">answered</span>}
        <span className="text-muted-foreground ml-auto" title={formatDateTime(item.at, timezone)}>
          {relativeTime(item.at)}
        </span>
      </div>
      <p
        className={cn(
          'break-words whitespace-pre-wrap',
          emphasis ? 'text-sm' : 'text-muted-foreground',
          item.kind === 'log' && 'font-mono text-[11px]',
        )}
      >
        {item.text}
      </p>
      {item.detail && <p className="text-muted-foreground break-words italic">{item.detail}</p>}
    </li>
  )
}

/** A task's conversation. Command-level detail stays folded until asked for. */
export function Thread({
  slug,
  taskId,
  timezone,
}: {
  slug: string
  taskId: string
  timezone: string
}) {
  const { data = [] } = useQuery(threadQuery(slug, taskId))
  const [showLogs, setShowLogs] = useState(false)
  const logs = data.filter((i) => i.kind === 'log').length
  const shown = data.filter((i) => showLogs || i.kind !== 'log')
  return (
    <section className="grid gap-2" aria-label="Conversation">
      <div className="flex items-center gap-2">
        <h3 className="text-muted-foreground text-xs font-medium uppercase">Conversation</h3>
        {logs > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-xs"
            onClick={() => setShowLogs((v) => !v)}
          >
            {showLogs ? 'Hide' : 'Show'} {logs} command{logs === 1 ? '' : 's'}
          </Button>
        )}
      </div>
      <ul className="grid gap-2.5">
        {shown.map((i) => (
          <Item key={i.id} item={i} timezone={timezone} />
        ))}
      </ul>
    </section>
  )
}
