import type { CellStatus, TaskAction, TaskState } from '@stagegrid/shared'

export interface TaskLike {
  state: TaskState
  required: boolean
}

/** States in which work on a task has begun and not yet been accepted. */
const IN_FLIGHT: ReadonlySet<TaskState> = new Set([
  'in_progress',
  'waiting_for_answer',
  'ready_for_acceptance',
  'changes_requested',
])

/**
 * The status a task-managed cell should have (spec D-06). Only required, non-cancelled tasks count:
 * none -> todo (never a vacuous done), all accepted -> done, any started or accepted -> doing.
 */
export function aggregateCellStatus(
  tasks: readonly TaskLike[],
): Extract<CellStatus, 'todo' | 'doing' | 'done'> {
  const counted = tasks.filter((t) => t.required && t.state !== 'cancelled')
  if (counted.length === 0) return 'todo'
  if (counted.every((t) => t.state === 'done')) return 'done'
  if (counted.some((t) => t.state === 'done' || IN_FLIGHT.has(t.state))) return 'doing'
  return 'todo'
}

/** True when the task still holds its cell back from being done (used to explain a blocked skip). */
export function isActiveTask(t: TaskLike): boolean {
  return t.required && t.state !== 'cancelled' && t.state !== 'done'
}

interface Transition {
  from: readonly TaskState[]
  to: TaskState
  /** Reopening and cancelling change committed work, so they must say why. */
  reasonRequired?: boolean
}

/** Human-driven transitions. Runs and questions add their own transitions in later phases. */
export const TASK_TRANSITIONS: Record<TaskAction, Transition> = {
  mark_ready: { from: ['draft'], to: 'ready' },
  start: { from: ['ready', 'changes_requested'], to: 'in_progress' },
  submit: { from: ['in_progress'], to: 'ready_for_acceptance' },
  accept: { from: ['ready_for_acceptance'], to: 'done' },
  request_changes: {
    from: ['ready_for_acceptance'],
    to: 'changes_requested',
    reasonRequired: true,
  },
  reopen: { from: ['done'], to: 'changes_requested', reasonRequired: true },
  cancel: {
    from: [
      'draft',
      'ready',
      'in_progress',
      'waiting_for_answer',
      'ready_for_acceptance',
      'changes_requested',
    ],
    to: 'cancelled',
    reasonRequired: true,
  },
  restore: { from: ['cancelled'], to: 'draft' },
}

export type TransitionResult =
  | { ok: true; to: TaskState; reasonRequired: boolean }
  | { ok: false; reason: 'not_allowed'; allowedFrom: readonly TaskState[] }

export function resolveTransition(action: TaskAction, from: TaskState): TransitionResult {
  const t = TASK_TRANSITIONS[action]
  if (!t.from.includes(from)) return { ok: false, reason: 'not_allowed', allowedFrom: t.from }
  return { ok: true, to: t.to, reasonRequired: t.reasonRequired ?? false }
}

/** Actions a human can take on a task in `state` (drives which buttons the UI shows). */
export function availableActions(state: TaskState): TaskAction[] {
  return (Object.keys(TASK_TRANSITIONS) as TaskAction[]).filter((a) =>
    TASK_TRANSITIONS[a].from.includes(state),
  )
}
