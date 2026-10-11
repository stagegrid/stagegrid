import type { BoardCellDto, BoardDto } from '@stagegrid/shared'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api'

import { NewTaskDialog } from './NewTaskDialog'
import { useTaskMutations, useTasks } from './queries'
import { TASK_STATE_LABEL } from './status'
import { TaskActions } from './TaskActions'

/**
 * In a cell's popover: how the cell tracks progress and, when it follows tasks, the tasks that
 * decide its status. Switching modes is a deliberate button, never a side effect.
 */
export function CellTasks({
  board,
  cell,
  canEdit,
  isOwner,
}: {
  board: BoardDto
  cell: BoardCellDto
  canEdit: boolean
  isOwner: boolean
}) {
  const slug = board.project.slug
  const { setMode } = useTaskMutations(slug)
  const managed = cell.progressMode === 'tasks'
  const { data: tasks = [] } = useTasks(slug, managed ? cell.id : undefined)
  const [creating, setCreating] = useState(false)
  const toggle = (mode: 'manual' | 'tasks') =>
    setMode.mutate({ cellId: cell.id, mode }, { onError: (e) => toast.error(errorMessage(e)) })

  if (!managed) {
    if (!canEdit || cell.status === 'skip') return null
    return (
      <div className="grid gap-1.5 border-t pt-3">
        <h3 className="text-muted-foreground text-xs font-medium uppercase">Tasks</h3>
        <p className="text-muted-foreground text-xs">
          The status is set by hand. Switch it to follow tasks if several pieces of work decide it.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          disabled={setMode.isPending}
          onClick={() => toggle('tasks')}
        >
          Manage with tasks
        </Button>
      </div>
    )
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <div className="flex items-center gap-2">
        <h3 className="text-muted-foreground text-xs font-medium uppercase">Tasks</h3>
        {canEdit && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="ml-auto"
            aria-label="Add task"
            onClick={() => setCreating(true)}
          >
            <PlusIcon />
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        The status follows the required tasks: done when all are accepted.
      </p>
      {tasks.length === 0 && <p className="text-muted-foreground text-xs">No tasks yet.</p>}
      <ul className="grid gap-2">
        {tasks.map((t) => (
          <li key={t.id} className="grid gap-1.5 rounded-md border p-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium break-words">{t.title}</span>
              {!t.required && (
                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                  Optional
                </Badge>
              )}
              <Badge variant="secondary" className="ml-auto">
                {TASK_STATE_LABEL[t.state]}
              </Badge>
            </div>
            <TaskActions slug={slug} task={t} canEdit={canEdit} />
          </li>
        ))}
      </ul>
      {isOwner && (
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start"
          disabled={setMode.isPending}
          onClick={() => toggle('manual')}
        >
          Set status by hand again
        </Button>
      )}
      <NewTaskDialog
        board={board}
        open={creating}
        initialCellId={cell.id}
        onClose={() => setCreating(false)}
      />
    </div>
  )
}
