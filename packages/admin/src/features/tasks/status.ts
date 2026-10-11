import type { TaskAction, TaskState } from '@stagegrid/shared'

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  draft: 'Draft',
  ready: 'Ready',
  in_progress: 'In progress',
  waiting_for_answer: 'Waiting for an answer',
  ready_for_acceptance: 'Awaiting acceptance',
  changes_requested: 'Changes requested',
  done: 'Done',
  cancelled: 'Cancelled',
}

export const TASK_ACTION_LABEL: Record<TaskAction, string> = {
  mark_ready: 'Mark ready',
  start: 'Start',
  submit: 'Submit for acceptance',
  accept: 'Accept',
  request_changes: 'Request changes',
  reopen: 'Reopen',
  cancel: 'Cancel task',
  restore: 'Restore as draft',
}

/** Kanban columns. Waiting-for-answer shares a column with in progress: both mean work is under way. */
export const KANBAN_COLUMNS: { key: string; title: string; states: TaskState[] }[] = [
  { key: 'draft', title: 'Draft', states: ['draft'] },
  { key: 'ready', title: 'Ready', states: ['ready'] },
  { key: 'in_progress', title: 'In progress', states: ['in_progress', 'waiting_for_answer'] },
  { key: 'acceptance', title: 'Awaiting acceptance', states: ['ready_for_acceptance'] },
  { key: 'changes', title: 'Changes requested', states: ['changes_requested'] },
  { key: 'done', title: 'Done', states: ['done'] },
]

/** Tone of the small dot on a task card: only states that need a person's attention stand out. */
export const TASK_STATE_DOT: Record<TaskState, string> = {
  draft: 'bg-muted-foreground/40',
  ready: 'bg-muted-foreground',
  in_progress: 'bg-status-doing',
  waiting_for_answer: 'bg-status-doing',
  ready_for_acceptance: 'bg-primary',
  changes_requested: 'bg-destructive',
  done: 'bg-status-done',
  cancelled: 'bg-status-skip',
}

/** Steps the system takes on a task as its runs progress. */
export const SYSTEM_ACTION_LABEL: Record<string, string> = {
  claim: 'Run started',
  run_succeeded: 'Run finished',
  run_cancelled: 'Run cancelled',
}
