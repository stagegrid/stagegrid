import {
  CELL_PROGRESS_MODES,
  CELL_STATUSES,
  EMPLOYEE_PROVIDERS,
  EMPLOYEE_ROLES,
  PROJECT_ROLES,
  QUESTION_BATCH_STATES,
  QUESTION_STATES,
  REVIEW_STATES,
  RUN_ROLES,
  RUN_STATES,
  SUBMISSION_STATES,
  TASK_ROLES,
  TASK_STATES,
  USER_STATUSES,
  VIAS,
} from '@stagegrid/shared'
import { pgEnum } from 'drizzle-orm/pg-core'

export const cellStatus = pgEnum('cell_status', CELL_STATUSES)
export const cellProgressMode = pgEnum('cell_progress_mode', CELL_PROGRESS_MODES)
export const taskState = pgEnum('task_state', TASK_STATES)
export const employeeRole = pgEnum('employee_role', EMPLOYEE_ROLES)
export const employeeProvider = pgEnum('employee_provider', EMPLOYEE_PROVIDERS)
export const questionBatchState = pgEnum('question_batch_state', QUESTION_BATCH_STATES)
export const questionState = pgEnum('question_state', QUESTION_STATES)
export const submissionState = pgEnum('submission_state', SUBMISSION_STATES)
export const runRole = pgEnum('run_role', RUN_ROLES)
export const taskRole = pgEnum('task_role', TASK_ROLES)
export const reviewState = pgEnum('review_state', REVIEW_STATES)
export const runState = pgEnum('run_state', RUN_STATES)
export const projectRole = pgEnum('project_role', PROJECT_ROLES)
export const userStatus = pgEnum('user_status', USER_STATUSES)
export const actorVia = pgEnum('actor_via', VIAS)
export const roundOutcome = pgEnum('round_outcome', ['done', 'stopped'])
export const inviteKind = pgEnum('invite_kind', ['invite', 'reset'])
export const linkKind = pgEnum('link_kind', ['doc', 'design', 'issue', 'other'])
export const releaseStatus = pgEnum('release_status', ['active', 'released', 'cancelled'])
export const releaseItemKind = pgEnum('release_item_kind', ['new', 'change'])
