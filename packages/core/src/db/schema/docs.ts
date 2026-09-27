import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './auth'
import { items, projects, stages } from './projects'
import { releases } from './releases'

const ts = (name: string) => timestamp(name, { withTimezone: true })
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const docTemplates = pgTable('doc_templates', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['narrative', 'form'] }).notNull(),
  level: text('level', { enum: ['project', 'item', 'release'] }).notNull(),
  schema: jsonb('schema').notNull(),
  baseDocx: bytea('base_docx'),
  builtin: boolean('builtin').notNull().default(false),
  archivedAt: ts('archived_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
})

export const projectDocTemplates = pgTable(
  'project_doc_templates',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => docTemplates.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.templateId] })],
)

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => items.id),
    stageId: uuid('stage_id').references(() => stages.id),
    releaseId: uuid('release_id').references(() => releases.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => docTemplates.id),
    templateSnapshot: jsonb('template_snapshot').notNull(),
    title: text('title').notNull(),
    draft: jsonb('draft').notNull(),
    version: integer('version').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('documents_project_idx').on(t.projectId)],
)

export const documentRevisions = pgTable(
  'document_revisions',
  {
    id: uuid('id').primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    draft: jsonb('draft').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('document_revisions_version_uq').on(t.documentId, t.version)],
)
