import { CELL_STATUSES, PROJECT_ROLES, USER_STATUSES, VIAS } from '@stagegrid/shared'
import { pgEnum } from 'drizzle-orm/pg-core'

export const cellStatus = pgEnum('cell_status', CELL_STATUSES)
export const projectRole = pgEnum('project_role', PROJECT_ROLES)
export const userStatus = pgEnum('user_status', USER_STATUSES)
export const actorVia = pgEnum('actor_via', VIAS)
export const roundOutcome = pgEnum('round_outcome', ['done', 'stopped'])
export const inviteKind = pgEnum('invite_kind', ['invite', 'reset'])
export const linkKind = pgEnum('link_kind', ['doc', 'design', 'issue', 'other'])
export const releaseStatus = pgEnum('release_status', ['active', 'released', 'cancelled'])
export const releaseItemKind = pgEnum('release_item_kind', ['new', 'change'])
