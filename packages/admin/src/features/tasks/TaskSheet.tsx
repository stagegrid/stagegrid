import { useQuery } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { SubmissionPanel } from '@/features/delivery/SubmissionPanel'
import { EmployeeBadge } from '@/features/employees/EmployeeBadge'
import { QuestionPanel } from '@/features/questions/QuestionPanel'
import { Thread } from '@/features/questions/Thread'
import { RunPanel } from '@/features/runs/RunPanel'

import { taskQuery } from './queries'
import { TASK_STATE_LABEL } from './status'
import { TaskActions } from './TaskActions'
import { TaskContext } from './TaskContext'

/** A task's scope, criteria, next actions and who did what, in a side sheet. */
export function TaskSheet({
  slug,
  taskId,
  timezone,
  canEdit,
  onClose,
}: {
  slug: string
  taskId: string | null
  timezone: string
  canEdit: boolean
  onClose: () => void
}) {
  const { data: task } = useQuery({ ...taskQuery(slug, taskId ?? ''), enabled: !!taskId })
  return (
    <Sheet open={taskId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="pr-6 break-words">{task?.title ?? 'Task'}</SheetTitle>
          <SheetDescription>
            {task ? `${task.itemPath} › ${task.stageName}` : 'Loading…'}
          </SheetDescription>
        </SheetHeader>
        {!task ? (
          <Skeleton className="mx-4 h-32" />
        ) : (
          <div className="grid gap-4 px-4 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{TASK_STATE_LABEL[task.state]}</Badge>
              {!task.required && <Badge variant="outline">Optional</Badge>}
              {task.owner && (
                <span className="text-muted-foreground text-xs">Owner: {task.owner.name}</span>
              )}
            </div>
            {task.employee && <EmployeeBadge employee={task.employee} />}
            {task.employee && <QuestionPanel slug={slug} task={task} canEdit={canEdit} />}
            {task.employee && <TaskContext slug={slug} task={task} canEdit={canEdit} />}
            {task.employee && (
              <RunPanel slug={slug} task={task} timezone={timezone} canEdit={canEdit} />
            )}
            <SubmissionPanel slug={slug} task={task} timezone={timezone} canEdit={canEdit} />
            <TaskActions slug={slug} task={task} canEdit={canEdit} />
            {task.scope && (
              <section className="grid gap-1">
                <h3 className="text-muted-foreground text-xs font-medium uppercase">Scope</h3>
                <p className="text-sm break-words whitespace-pre-wrap">{task.scope}</p>
              </section>
            )}
            {task.acceptanceCriteria.length > 0 && (
              <section className="grid gap-1">
                <h3 className="text-muted-foreground text-xs font-medium uppercase">
                  Acceptance criteria
                </h3>
                <ul className="list-disc pl-4 text-sm">
                  {task.acceptanceCriteria.map((c, i) => (
                    <li key={i} className="break-words">
                      {c}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <Thread slug={slug} taskId={task.id} timezone={timezone} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
