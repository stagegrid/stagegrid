import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { users } from './auth'

const ts = (name: string) => timestamp(name, { withTimezone: true })

/** Dynamically registered public clients (RFC 7591); PKCE is mandatory. */
export const oauthClients = pgTable('oauth_clients', {
  id: uuid('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientName: text('client_name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export const oauthCodes = pgTable('oauth_codes', {
  id: uuid('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  clientId: text('client_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource'),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/** One row per issued access/refresh pair; refresh rotation links rows by `familyId`. */
export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey(),
    familyId: uuid('family_id').notNull(),
    clientId: text('client_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessHash: text('access_hash').notNull().unique(),
    refreshHash: text('refresh_hash').notNull().unique(),
    scope: text('scope').notNull(),
    accessExpiresAt: ts('access_expires_at').notNull(),
    refreshExpiresAt: ts('refresh_expires_at').notNull(),
    refreshUsedAt: ts('refresh_used_at'),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('oauth_tokens_user_idx').on(t.userId),
    index('oauth_tokens_family_idx').on(t.familyId),
  ],
)
