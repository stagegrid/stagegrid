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
} as const

export const LINK_KINDS = ['doc', 'design', 'issue', 'other'] as const
export type LinkKind = (typeof LINK_KINDS)[number]
