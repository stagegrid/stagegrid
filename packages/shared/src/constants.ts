export const CELL_STATUSES = ['skip', 'todo', 'doing', 'done'] as const
export type CellStatus = (typeof CELL_STATUSES)[number]

export const PROJECT_ROLES = ['owner', 'editor', 'viewer'] as const
export type ProjectRole = (typeof PROJECT_ROLES)[number]

/** Higher number = more permissions. */
export const ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 }

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const VIAS = ['web', 'mcp', 'api', 'cli', 'system'] as const
export type Via = (typeof VIAS)[number]

export const DEFAULT_STAGES = [
  'Design',
  'Document',
  'Database',
  'Implement',
  'QA',
  'Deploy',
] as const

export const PATH_SEPARATOR = ' > '

export const LIMITS = {
  projectName: 100,
  projectDescription: 2000,
  stageName: 60,
  itemName: 200,
  userName: 100,
  reason: 1000,
  activeStagesPerProject: 30,
  itemsPerProject: 5000,
  changesPerRequest: 500,
  itemsPerCreate: 1000,
  staleDaysMin: 1,
  staleDaysMax: 365,
  passwordMin: 10,
  passwordMax: 200,
  commentBody: 10_000,
  linkTitle: 200,
  linkUrl: 2000,
  assigneeName: 100,
  assigneesPerCell: 20,
  taskTitle: 200,
  taskScope: 10_000,
  acceptanceCriteria: 50,
  acceptanceCriterion: 500,
  tasksPerCell: 200,
  employeeName: 60,
  employeeInstructions: 10_000,
  employeeAvatar: 8,
  employeesPerProject: 50,
  modelName: 100,
  contextDocuments: 30,
  contextSources: 30,
  contextSourceContent: 100_000,
  contextDecisions: 50,
  contextDecision: 1000,
  runnerName: 100,
  runnerProjects: 100,
  runEventPayload: 20_000,
  runSummary: 20_000,
  runFailure: 2000,
  idempotencyKey: 200,
} as const

export const LINK_KINDS = ['doc', 'design', 'issue', 'other'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

/** How a cell's status is decided: written directly (`manual`) or derived from its tasks (`tasks`). */
export const CELL_PROGRESS_MODES = ['manual', 'tasks'] as const
export type CellProgressMode = (typeof CELL_PROGRESS_MODES)[number]

export const TASK_STATES = [
  'draft',
  'ready',
  'in_progress',
  'waiting_for_answer',
  'ready_for_acceptance',
  'changes_requested',
  'done',
  'cancelled',
] as const
export type TaskState = (typeof TASK_STATES)[number]

export const TASK_ACTIONS = [
  'mark_ready',
  'start',
  'submit',
  'accept',
  'request_changes',
  'reopen',
  'cancel',
  'restore',
] as const
export type TaskAction = (typeof TASK_ACTIONS)[number]

/** Actions that change committed work, so the person must say why. */
export const TASK_ACTIONS_NEEDING_REASON: readonly TaskAction[] = [
  'request_changes',
  'reopen',
  'cancel',
]

export const EMPLOYEE_ROLES = ['analyst', 'dev', 'reviewer', 'qa'] as const
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number]

/** AI runtimes an employee can work through. */
export const EMPLOYEE_PROVIDERS = ['claude_code', 'codex'] as const
export type EmployeeProvider = (typeof EMPLOYEE_PROVIDERS)[number]

export const RUN_STATES = [
  'queued',
  'running',
  'waiting_for_answer',
  'waiting_for_capacity',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
] as const
export type RunState = (typeof RUN_STATES)[number]

/** A task has at most one run in these states. */
export const ACTIVE_RUN_STATES: readonly RunState[] = [
  'queued',
  'running',
  'waiting_for_answer',
  'waiting_for_capacity',
]

/** A claim lasts this long without a heartbeat or event; the runner renews it. */
export const RUN_LEASE_SECONDS = 90
/** A runner that hasn't polled for this long is treated as offline. */
export const RUNNER_ONLINE_SECONDS = 120
export const RUNNER_ENROLLMENT_MINUTES = 60

export const RUN_EVENT_TYPES = ['progress', 'log', 'session'] as const
export type RunEventType = (typeof RUN_EVENT_TYPES)[number]

export const RUN_OUTCOMES = ['succeeded', 'failed', 'interrupted'] as const
export type RunOutcome = (typeof RUN_OUTCOMES)[number]
