import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { inviteKind, userStatus } from './enums'

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  isAdmin: boolean('is_admin').notNull().default(false),
  status: userStatus('status').notNull().default('invited'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const inviteTokens = pgTable(
  'invite_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: inviteKind('kind').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('invite_tokens_user_idx').on(t.userId)],
)

export const instanceSettings = pgTable('instance_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
)
