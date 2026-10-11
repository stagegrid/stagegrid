import { type BoardTaskDto, TASK_ACTIONS_NEEDING_REASON, type TaskAction } from '@stagegrid/shared'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'

import { useTaskMutations } from './queries'
import { TASK_ACTION_LABEL } from './status'

const PRIMARY: TaskAction[] = ['mark_ready', 'start', 'submit', 'accept']

/** The buttons for what a person can do next, asking for a reason where the action needs one. */
export function TaskActions({
  slug,
  task,
  canEdit,
  onDone,
}: {
  slug: string
  task: Pick<BoardTaskDto, 'id' | 'version' | 'actions'>
  canEdit: boolean
  onDone?: () => void
}) {
  const { act } = useTaskMutations(slug)
  const [asking, setAsking] = useState<TaskAction | null>(null)
  const [reason, setReason] = useState('')
  if (!canEdit || task.actions.length === 0) return null

  const run = (action: TaskAction, why?: string) =>
    act.mutate(
      { id: task.id, action, expectedVersion: task.version, ...(why ? { reason: why } : {}) },
      {
        onSuccess: () => {
          setAsking(null)
          setReason('')
          onDone?.()
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    )

  if (asking) {
    return (
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (reason.trim()) run(asking, reason.trim())
        }}
      >
        <Input
          autoFocus
          aria-label="Reason"
          placeholder="Why? This is kept in the task history"
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!reason.trim() || act.isPending}>
            {TASK_ACTION_LABEL[asking]}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(null)}>
            Back
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {task.actions.map((a) => (
        <Button
          key={a}
          size="sm"
          variant={PRIMARY.includes(a) ? 'default' : 'outline'}
          disabled={act.isPending}
          onClick={() => (TASK_ACTIONS_NEEDING_REASON.includes(a) ? setAsking(a) : run(a))}
        >
          {TASK_ACTION_LABEL[a]}
        </Button>
      ))}
    </div>
  )
}
