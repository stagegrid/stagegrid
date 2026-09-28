import type { UserDto } from '@stagegrid/shared'

import type { users } from '../db/schema'

export type UserRow = typeof users.$inferSelect

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    status: u.status,
    createdAt: u.createdAt.toISOString(),
  }
}
