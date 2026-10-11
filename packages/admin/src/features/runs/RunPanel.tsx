import type { TaskDetailDto } from '@stagegrid/shared'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { formatDateTime, relativeTime } from '@/lib/format'

import { useRunMutations } from './queries'
import { isActiveRun, needsAttention, RUN_STATE_LABEL } from './status'

/**
 * What the employee's latest run is doing and what a person can do about it: start it, retry after
 * a failure, or stop it. A paused run needs nothing: it continues by itself after the limit resets.
 */
export function RunPanel({
  slug,
  task,
  timezone,
  canEdit,
}: {
  slug: string
  task: TaskDetailDto
  timezone: string
  canEdit: boolean
}) {
  const { start, cancel } = useRunMutations(slug)
  const [stopping, setStopping] = useState(false)
  const [reason, setReason] = useState('')
  const run = task.run
  const active = isActiveRun(run?.state)
  const startable =
    task.state === 'ready' ||
    task.state === 'changes_requested' ||
    (task.state === 'in_progress' && needsAttention(run?.state))
  const canStart = canEdit && !!task.context && startable && !active
  const onError = (e: unknown) => toast.error(errorMessage(e))

  return (
    <section className="grid gap-2">
      <h3 className="text-muted-foreground text-xs font-medium uppercase">Run</h3>
      {run ? (
        <div className="grid gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={needsAttention(run.state) ? 'destructive' : 'secondary'}>
              {RUN_STATE_LABEL[run.state]}
            </Badge>
            <span className="text-muted-foreground text-xs">
              Attempt {run.attempt}
              {run.runnerName ? ` on ${run.runnerName}` : ''}
            </span>
          </div>
          {run.state === 'waiting_for_capacity' && run.resumeAt && (
            <p className="text-muted-foreground text-xs">
              The AI account hit its usage limit. This continues by itself{' '}
              <span title={formatDateTime(run.resumeAt, timezone)}>
                {relativeTime(run.resumeAt)}
              </span>
              .
            </p>
          )}
          {run.state === 'queued' && (
            <p className="text-muted-foreground text-xs">
              A runner picks this up when it has room. Nothing to do.
            </p>
          )}
          {run.failureReason && needsAttention(run.state) && (
            <p className="text-xs break-words">{run.failureReason}</p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">No run yet.</p>
      )}

      {canEdit && stopping && run && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            cancel.mutate(
              { runId: run.id, reason: reason.trim() || undefined },
              { onSuccess: () => setStopping(false), onError },
            )
          }}
        >
          <Input
            aria-label="Why stop this run"
            placeholder="Why? Optional"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={cancel.isPending}>
              Stop run
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setStopping(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
      {!stopping && (
        <div className="flex flex-wrap gap-2">
          {canStart && task.context && (
            <Button
              size="sm"
              disabled={start.isPending}
              onClick={() =>
                start.mutate(
                  {
                    taskId: task.id,
                    expectedVersion: task.version,
                    contextRevisionId: task.context!.revisionId,
                  },
                  { onError },
                )
              }
            >
              {needsAttention(run?.state) ? 'Retry' : 'Start run'}
            </Button>
          )}
          {canEdit && active && (
            <Button size="sm" variant="outline" onClick={() => setStopping(true)}>
              Stop run
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
