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
