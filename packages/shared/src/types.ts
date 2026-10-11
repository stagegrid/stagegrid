import type {
  ArtifactKind,
  Ceilings,
  CellProgressMode,
  CellStatus,
  DeliverySettings,
  EmployeeProvider,
  EmployeeRole,
  EvidenceSource,
  LinkKind,
  ProjectRole,
  ProviderCapacity,
  QuestionBatchState,
  QuestionState,
  RunState,
  SubmissionState,
  TaskAction,
  TaskState,
  UserStatus,
  Via,
} from './constants'

export type StaleReason = 'doing_too_long' | 'past_planned_end'

export interface Stats {
  all: number
  open: number
  doing: number
  done: number
  percent: number
  rework: number
  stale: number
}

export interface UserDto {
  id: string
  email: string
  name: string
  isAdmin: boolean
  status: UserStatus
  createdAt: string
}

export interface ProjectDto {
  id: string
  slug: string
  name: string
  description: string
  timezone: string
  staleDays: number
  archivedAt: string | null
  role: ProjectRole
  stats: Stats
  /** Nearest active release by target date (phase 5). */
  nextRelease: { id: string; name: string; targetDate: string; percent: number } | null
  defaultReleasePhases: { name: string; freeze?: boolean }[]
  delivery: DeliverySettings
}

export interface StageDto {
  id: string
  name: string
  position: string
  archivedAt: string | null
}

export interface AssigneeDto {
  userId: string | null
  name: string
}

export interface BoardItemDto {
  id: string
  parentId: string | null
  name: string
  position: string
  depth: number
  /** Union of the assignees of this item's cells. */
  assignees: AssigneeDto[]
  /** Active releases this item is in (phase 5). */
  releases: { id: string; name: string }[]
}

export interface BoardCellDto {
  id: string
  status: CellStatus
  progressMode: CellProgressMode
  rework: number
  stale: StaleReason | null
  hasComments: boolean
  hasDocLink: boolean
}

export interface BoardDto {
  project: {
    id: string
    slug: string
    name: string
    timezone: string
    staleDays: number
    role: ProjectRole
  }
  stages: StageDto[]
  items: BoardItemDto[]
  cells: Record<string, Record<string, BoardCellDto>>
  stats: Stats & { items: number; byStage: Record<string, Stats> }
}

export interface ActorDto {
  userId: string | null
  name: string
  via: Via
}

export interface CellEventDto {
  id: string
  fromStatus: CellStatus
  toStatus: CellStatus
  happenedAt: string
  recordedAt: string
  actor: ActorDto
  reason: string | null
}

export interface CellRoundDto {
  roundNo: number
  startedAt: string
  endedAt: string | null
  outcome: 'done' | 'stopped' | null
}

export interface CellDetailDto {
  id: string
  itemId: string
  itemPath: string
  stageId: string
  stageName: string
  status: CellStatus
  progressMode: CellProgressMode
  rework: number
  stale: StaleReason | null
  plannedStart: string | null
  plannedEnd: string | null
  events: CellEventDto[]
  rounds: CellRoundDto[]
  assignees: AssigneeDto[]
  comments: CommentDto[]
  links: LinkDto[]
}

export interface CommentDto {
  id: string
  body: string
  author: ActorDto
  createdAt: string
  editedAt: string | null
}

export interface LinkDto {
  id: string
  title: string
  url: string
  kind: LinkKind
  createdAt: string
}

export interface ChangeResultDto {
  index: number
  cellId: string
  item: string
  stage: string
  outcome: 'changed' | 'unchanged'
  before: { status: CellStatus }
  after: { status: CellStatus }
  backdatedBeforeLaterEvent: boolean
  /** Which non-status parts changed: assignees, planned, comment, link. */
  details: ('assignees' | 'planned' | 'comment' | 'link')[]
}

export interface ChangesResultDto {
  dryRun: boolean
  applied: number
  unchanged: number
  results: ChangeResultDto[]
}

export interface TokenDto {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export interface RealtimeEvent {
  type: string
  projectId: string
  actor: ActorDto
  at: string
  [key: string]: unknown
}

export interface TimelineLaneDto {
  cellId: string
  stageId: string
  status: CellStatus
  plannedStart: string | null
  plannedEnd: string | null
  /** Past planned end and not done/skip. */
  overdue: boolean
  rounds: CellRoundDto[]
}

export interface TimelineItemDto {
  id: string
  parentId: string | null
  name: string
  depth: number
  lanes: TimelineLaneDto[]
}

export interface TimelineDto {
  project: { slug: string; name: string; timezone: string; role: ProjectRole }
  /** "Today" in the project's time zone (YYYY-MM-DD). */
  today: string
  /** Earliest and latest dates with data (defaults to today). */
  from: string
  to: string
  stages: { id: string; name: string }[]
  items: TimelineItemDto[]
}

export interface BurnupDto {
  points: { date: string; scope: number; done: number }[]
}

export type ReleaseDisplayStatus = 'planned' | 'in_progress' | 'at_risk' | 'released' | 'cancelled'

export interface ReleasePhaseDto {
  id: string
  name: string
  plannedStart: string | null
  plannedEnd: string | null
  freeze: boolean
}

export type ReleaseRiskCode =
  | 'past_target'
  | 'planned_after_target'
  | 'planned_after_freeze'
  | 'not_started_near_freeze'
  | 'not_started_near_target'

export interface ReleaseRiskDto {
  code: ReleaseRiskCode
  message: string
  cellId?: string
  item?: string
  stage?: string
}

export interface ReleaseSummaryDto {
  id: string
  name: string
  targetDate: string
  status: 'active' | 'released' | 'cancelled'
  displayStatus: ReleaseDisplayStatus
  stats: Stats
  riskCount: number
  itemCount: { new: number; change: number }
  releasedAt: string | null
}

export interface ReleaseScopeItemDto {
  id: string
  parentId: string | null
  name: string
  path: string
  depth: number
  /** null = shown only as context (an ancestor of an item in scope). */
  kind: 'new' | 'change' | null
  note: string | null
  /** stageId → cell, only for cells in scope. */
  cells: Record<string, { cellId: string; status: CellStatus; stale: StaleReason | null }>
}

export interface ReleaseDetailDto extends ReleaseSummaryDto {
  description: string
  project: { slug: string; name: string; timezone: string; role: ProjectRole }
  today: string
  phases: ReleasePhaseDto[]
  risks: ReleaseRiskDto[]
  stages: { id: string; name: string }[]
  scope: ReleaseScopeItemDto[]
  snapshot: ReleaseSnapshot | null
}

export interface ReleaseSnapshot {
  releasedAt: string
  targetDate: string
  phases: ReleasePhaseDto[]
  stats: Stats
  items: {
    path: string
    kind: 'new' | 'change'
    note: string | null
    cells: { stage: string; status: CellStatus }[]
  }[]
}

export type DocTemplateLevel = 'project' | 'item' | 'release'

export interface DocTemplateDto {
  id: string
  key: string
  name: string
  kind: 'narrative' | 'form'
  level: DocTemplateLevel
  builtin: boolean
  archived: boolean
  hasBaseDocx: boolean
  sectionCount: number
}

export interface DocumentSummaryDto {
  id: string
  title: string
  template: { id: string; key: string; name: string }
  item: { id: string; path: string } | null
  stage: { id: string; name: string } | null
  release: { id: string; name: string } | null
  version: number
  updatedAt: string
  updatedBy: string
}

export interface DocumentDto extends DocumentSummaryDto {
  /** Template as it was when the document was created (spec 02 §5). */
  template: DocumentSummaryDto['template'] & { kind: 'narrative' | 'form' }
  /** Sections and fields resolved against the project (repeat sections expanded). */
  resolved: {
    kind: 'narrative' | 'form'
    sections: { id: string; number: string | null; title: string; level: 1 | 2 | 3; hint: string }[]
    fields: {
      id: string
      label: string
      hint: string
      type: 'text' | 'longtext' | 'date' | 'list' | 'table'
      columns?: { id: string; label: string }[]
    }[]
  }
  draft: {
    sections?: Record<string, string>
    fields?: Record<string, string | string[] | Record<string, string>[]>
  }
  revisions: { version: number; createdAt: string; by: string }[]
  project: { slug: string; name: string; timezone: string; role: ProjectRole }
  viewUrl: string
}

export interface EmployeeDto {
  id: string
  displayName: string
  role: EmployeeRole
  instructions: string
  provider: EmployeeProvider
  model: string | null
  avatar: string | null
  version: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

/** What a task card needs to show who the AI employee is. */
export interface EmployeeRefDto {
  id: string
  displayName: string
  role: EmployeeRole
  avatar: string | null
}

export interface ContextManifestDto {
  schemaVersion: 1
  documents: { documentId: string; revisionId: string; version: number; title: string }[]
  sources: { title: string; url: string | null; content: string; retrievedAt: string }[]
  decisions: string[]
}

/** A document the pinned context uses that has changed since it was pinned. */
export interface OutdatedDocumentDto {
  documentId: string
  title: string
  pinnedVersion: number
  currentVersion: number
}

export interface TaskContextSummaryDto {
  revisionId: string
  revisionNo: number
  createdAt: string
  outdated: OutdatedDocumentDto[]
}

export interface TaskContextDto extends TaskContextSummaryDto {
  manifest: ContextManifestDto
  manifestHash: string
}

/** The latest run of a task, enough to show what is happening and whether it needs a person. */
export interface TaskRunSummaryDto {
  id: string
  state: RunState
  attempt: number
  runnerName: string | null
  failureReason: string | null
  /** For waiting_for_capacity: when the run continues by itself. */
  resumeAt: string | null
  updatedAt: string
}

export interface RunDto extends TaskRunSummaryDto {
  taskId: string
  employeeId: string
  contextRevisionId: string
  runtime: { provider: string; model: string | null }
  summary: string | null
  leaseExpiresAt: string | null
  createdAt: string
  claimedAt: string | null
  finishedAt: string | null
}

export interface RunnerDto {
  id: string
  name: string
  providers: string[]
  version: string | null
  maxConcurrent: number
  /** Per provider; missing providers use the defaults. */
  ceilings: Record<string, Ceilings>
  /** Latest usage the runner reported, per provider. */
  capacity: Record<string, ProviderCapacity>
  online: boolean
  lastSeenAt: string | null
  projectIds: string[]
  revokedAt: string | null
  createdAt: string
}

export interface RunnerEnrollmentDto {
  id: string
  name: string
  /** Shown once; only its hash is stored. */
  token: string
  projectIds: string[]
  expiresAt: string
}

/** What a runner receives when it claims a run: everything needed, nothing it has to look up. */
export interface ClaimedRunDto {
  run: {
    id: string
    attempt: number
    fencingToken: number
    leaseExpiresAt: string
    sessionRef: string | null
    runtime: { provider: string; model: string | null; instructions: string }
  }
  project: { id: string; slug: string; name: string }
  employee: { id: string; displayName: string; role: string }
  task: { id: string; title: string; scope: string; acceptanceCriteria: string[] }
  context: TaskContextDto
  /** The pinned document revisions as Markdown, so the runner needn't fetch anything else. */
  documents: {
    documentId: string
    revisionId: string
    version: number
    title: string
    markdown: string
  }[]
  /** How far the work may leave this machine: nothing, a pushed branch, or a pull request. */
  delivery: DeliverySettings
  /** Answers people gave to the employee's earlier questions, oldest first. */
  answers: { question: string; answer: string }[]
}

export interface QuestionDto {
  id: string
  position: number
  prompt: string
  options: string[]
  state: QuestionState
  answer: string | null
  changesScope: boolean
  answeredBy: { userId: string; name: string } | null
  answeredAt: string | null
}

export interface QuestionBatchDto {
  id: string
  taskId: string
  runId: string
  contextRevisionId: string
  state: QuestionBatchState
  /** Answered, but the continuation waits for a new pinned context (a scope change). */
  holdForContext: boolean
  createdAt: string
  closedAt: string | null
  questions: QuestionDto[]
}

/** Something a person needs to act on: answer, look at a failed run, accept work. */
export interface AttentionItemDto {
  kind: 'question' | 'run_problem' | 'acceptance'
  taskId: string
  taskTitle: string
  itemPath: string
  stageName: string
  employee: EmployeeRefDto | null
  at: string
  summary: string
}

export interface ThreadItemDto {
  id: string
  kind: 'task_event' | 'progress' | 'log' | 'question' | 'answer'
  at: string
  actor: { name: string; via: Via; isEmployee: boolean }
  text: string
  /** Extra detail the reader can expand (a reason, the options offered). */
  detail: string | null
}

export interface QueuedRunDto {
  id: string
  projectId: string
  taskTitle: string
  attempt: number
  provider: string
}

export interface ArtifactDto {
  artifactId: string
  kind: ArtifactKind
  url: string | null
  repo: string | null
  branch: string | null
  headCommit: string
}

export interface CheckDto {
  command: string
  exitCode: number
  commit: string
  source: EvidenceSource
  output: string | null
}

/** What a run delivered and how well it is backed up. A person's acceptance is bound to this commit. */
export interface SubmissionDto {
  id: string
  runId: string
  state: SubmissionState
  headCommit: string
  summary: string
  contextRevisionId: string
  artifacts: ArtifactDto[]
  checks: CheckDto[]
  /** Checks that ran against the delivered commit, and how many of them passed. */
  evidence: { onCommit: number; passing: number; failing: number; strongest: EvidenceSource | null }
  createdAt: string
  decidedAt: string | null
  decidedBy: string | null
  decisionReason: string | null
}

export interface TaskDto {
  id: string
  cellId: string
  title: string
  scope: string
  acceptanceCriteria: string[]
  required: boolean
  state: TaskState
  version: number
  owner: { userId: string; name: string } | null
  employee: EmployeeRefDto | null
  /** The latest pinned context, or null when none has been pinned. */
  context: TaskContextSummaryDto | null
  /** The latest run, if any. */
  run: TaskRunSummaryDto | null
  /** The latest delivery by a run, if any. */
  submission: SubmissionDto | null
  /** What a person can do next from this state. */
  actions: TaskAction[]
  createdAt: string
  updatedAt: string
}

export interface TaskEventDto {
  id: string
  fromState: TaskState | null
  toState: TaskState
  action: string
  actor: ActorDto
  reason: string | null
  createdAt: string
}

/** A task with where it sits on the board, for the Kanban view. */
export interface BoardTaskDto extends TaskDto {
  itemId: string
  itemPath: string
  stageId: string
  stageName: string
}

export interface TaskDetailDto extends BoardTaskDto {
  events: TaskEventDto[]
}
