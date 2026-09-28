import type { CellStatus, LinkKind, ProjectRole, UserStatus, Via } from './constants'

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
