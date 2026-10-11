import type { BoardTaskDto } from '@stagegrid/shared'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'

import { EmptyState, ErrorState } from '@/components/page-state'
import { ProjectTabs } from '@/components/project-tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useBoard } from '@/features/board/queries'
import { useProjectStream } from '@/features/board/useProjectStream'
import { EmployeeBadge } from '@/features/employees/EmployeeBadge'
import { AttentionList } from '@/features/questions/AttentionList'
import { isActiveRun, needsAttention, RUN_STATE_LABEL } from '@/features/runs/status'
import { useProject } from '@/features/settings/queries'
import { cn } from '@/lib/utils'

import { NewTaskDialog } from './NewTaskDialog'
import { useTasks } from './queries'
import { KANBAN_COLUMNS, TASK_STATE_DOT, TASK_STATE_LABEL } from './status'
import { TaskSheet } from './TaskSheet'

function TaskCard({ task, onOpen }: { task: BoardTaskDto; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="bg-card hover:border-ring focus-visible:ring-ring grid w-full min-w-0 gap-1.5 rounded-lg border p-3 text-left text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="font-medium break-words">{task.title}</span>
      <span className="text-muted-foreground truncate text-xs">
        {task.itemPath} › {task.stageName}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={cn('size-2 shrink-0 rounded-full', TASK_STATE_DOT[task.state])} />
        <span>{TASK_STATE_LABEL[task.state]}</span>
        {!task.required && (
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            Optional
          </Badge>
        )}
        {task.owner && <span className="text-muted-foreground ml-auto">{task.owner.name}</span>}
      </span>
      {task.employee && <EmployeeBadge employee={task.employee} />}
      {task.run && (isActiveRun(task.run.state) || needsAttention(task.run.state)) && (
        <span
          className={cn(
            'text-xs',
            needsAttention(task.run.state) ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {RUN_STATE_LABEL[task.run.state]}
        </span>
      )}
    </button>
  )
}

export function TasksPage({ slug }: { slug: string }) {
  // Runs finish while you watch: keep tasks and cells live.
  useProjectStream(slug)
  const { data: project } = useProject(slug)
  const { data: board } = useBoard(slug)
  const { data: tasks, isLoading, error, refetch } = useTasks(slug)
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const canEdit = !!project && project.role !== 'viewer'
  const cancelled = tasks?.filter((t) => t.state === 'cancelled') ?? []

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <h1 className="truncate text-base font-semibold">{project?.name ?? '…'}</h1>
        <ProjectTabs slug={slug} />
        {canEdit && board && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <PlusIcon />
            New task
          </Button>
        )}
      </div>
      <div className="min-w-0 p-4">
        <AttentionList slug={slug} onOpen={setOpenId} />
        {isLoading && <Skeleton className="h-64" />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {tasks && tasks.length === 0 && (
          <EmptyState
            title="No tasks yet"
            body="Break the work for an item and stage into tasks. When a stage follows its tasks, accepting them is what moves its status on the board."
            action={canEdit && board && <Button onClick={() => setCreating(true)}>New task</Button>}
          />
        )}
        {tasks && tasks.length > 0 && (
          <>
            <div className="grid [grid-auto-columns:minmax(14rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
              {KANBAN_COLUMNS.map((col) => {
                const inCol = tasks.filter((t) => col.states.includes(t.state))
                return (
                  <section
                    key={col.key}
                    aria-label={col.title}
                    className="bg-muted/40 grid min-w-0 content-start gap-2 rounded-xl p-2"
                  >
                    <h2 className="flex items-center gap-2 px-1 text-xs font-medium uppercase">
                      {col.title}
                      <span className="text-muted-foreground">{inCol.length}</span>
                    </h2>
                    {inCol.map((t) => (
                      <TaskCard key={t.id} task={t} onOpen={() => setOpenId(t.id)} />
                    ))}
                  </section>
                )
              })}
            </div>
            {cancelled.length > 0 && (
              <div className="mt-4 grid max-w-xl gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => setShowCancelled((v) => !v)}
                >
                  {showCancelled ? 'Hide' : 'Show'} {cancelled.length} cancelled
                </Button>
                {showCancelled &&
                  cancelled.map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={() => setOpenId(t.id)} />
                  ))}
              </div>
            )}
          </>
        )}
      </div>
      {board && <NewTaskDialog board={board} open={creating} onClose={() => setCreating(false)} />}
      <TaskSheet
        slug={slug}
        taskId={openId}
        timezone={project?.timezone ?? 'UTC'}
        canEdit={canEdit}
        onClose={() => setOpenId(null)}
      />
    </div>
  )
}
