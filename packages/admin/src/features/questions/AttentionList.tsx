import { ClipboardCheckIcon, MessageCircleQuestionMarkIcon, TriangleAlertIcon } from 'lucide-react'

import { relativeTime } from '@/lib/format'

import { useAttention } from './queries'

/** What needs a person now. Each item opens its task. */
export function AttentionList({
  slug,
  onOpen,
}: {
  slug: string
  onOpen: (taskId: string) => void
}) {
  const { data = [] } = useAttention(slug)
  if (data.length === 0) return null
  return (
    <section aria-label="Needs your attention" className="mb-4 grid gap-2">
      <h2 className="text-xs font-medium uppercase">
        Needs your attention <span className="text-muted-foreground">{data.length}</span>
      </h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {data.map((a) => (
          <li key={`${a.kind}:${a.taskId}`}>
            <button
              type="button"
              onClick={() => onOpen(a.taskId)}
              className="bg-card hover:border-ring focus-visible:ring-ring grid w-full min-w-0 gap-1 rounded-lg border p-3 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="flex items-center gap-2">
                {a.kind === 'question' ? (
                  <MessageCircleQuestionMarkIcon className="size-4 shrink-0" />
                ) : a.kind === 'acceptance' ? (
                  <ClipboardCheckIcon className="size-4 shrink-0" />
                ) : (
                  <TriangleAlertIcon className="text-destructive size-4 shrink-0" />
                )}
                <span className="truncate font-medium">{a.taskTitle}</span>
                <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                  {relativeTime(a.at)}
                </span>
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {a.employee ? `${a.employee.displayName} · ` : ''}
                {a.itemPath} › {a.stageName}
              </span>
              <span className="line-clamp-2 text-xs break-words">{a.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
