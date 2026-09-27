import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { changeInput, itemNameSchema, itemTreeSchema, LIMITS, nameSchema } from '@stagegrid/shared'
import { z } from 'zod'

import { applyChanges } from '../../services/changes.service'
import type { ServiceContext } from '../../services/context'
import { createItems, deleteItem, moveItem, renameItem } from '../../services/items.service'
import { createProject } from '../../services/projects.service'
import { manageStages, type StageOp } from '../../services/stages.service'
import { run } from '../result'

const project = z.string().describe('Project slug (from list_projects) or id')
const itemRef = z.string().describe('Item path like "Settings > Users" or id')

export function registerWriteTools(server: McpServer, ctx: ServiceContext): void {
  server.registerTool(
    'apply_changes',
    {
      title: 'Apply status changes',
      description: `Change cell statuses (skip | todo | doing | done), all-or-nothing, up to ${LIMITS.changesPerRequest} per call.
When the changes come from another system or there is more than one, FIRST call with dryRun: true, show the user a table (Item › Stage | now | → new | when), wait for their confirmation, THEN call again with dryRun: false.
Set happenedAt to when it really happened (e.g. when the Jira issue moved) — Stagegrid builds its timeline from it. When reopening a done cell, give a reason.`,
      inputSchema: {
        project,
        changes: z.array(changeInput).min(1).max(LIMITS.changesPerRequest),
        dryRun: z.boolean().optional().describe('true = validate and preview without saving'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    ({ project: ref, changes, dryRun }) =>
      run(() => applyChanges(ctx, ref, { changes, dryRun: dryRun ?? false })),
  )

  server.registerTool(
    'create_items',
    {
      title: 'Create items',
      description:
        'Add items (menus/features) — a whole tree in one call. Each new item gets a "todo" cell in every stage. Use parent to add under an existing item, before/after to place among siblings.',
      inputSchema: {
        project,
        parent: itemRef.nullable().optional().describe('Add under this item; omit for top level'),
        before: itemRef.optional(),
        after: itemRef.optional(),
        items: z
          .array(itemTreeSchema)
          .min(1)
          .describe('e.g. [{"name":"Settings","children":[{"name":"Users"}]}]'),
      },
    },
    (input) => run(() => createItems(ctx, input.project, input)),
  )

  server.registerTool(
    'update_item',
    {
      title: 'Rename item',
      description: 'Rename an item.',
      inputSchema: { project, item: itemRef, name: itemNameSchema },
    },
    ({ project: ref, item, name }) => run(() => renameItem(ctx, ref, item, name)),
  )

  server.registerTool(
    'move_item',
    {
      title: 'Move item',
      description:
        'Move an item (with its children) under another parent and/or before/after a sibling. parent: null moves it to the top level.',
      inputSchema: {
        project,
        item: itemRef,
        parent: itemRef.nullable().optional(),
        before: itemRef.optional(),
        after: itemRef.optional(),
      },
    },
    ({ project: ref, item, ...rest }) => run(() => moveItem(ctx, ref, item, rest)),
  )

  server.registerTool(
    'delete_item',
    {
      title: 'Delete item',
      description:
        'Delete an item AND all its descendants from the board (history is kept). Confirm with the user first.',
      inputSchema: { project, item: itemRef },
      annotations: { destructiveHint: true },
    },
    ({ project: ref, item }) => run(() => deleteItem(ctx, ref, item)),
  )

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a project (admins only). Stages default to Design, Document, Database, Implement, QA, Deploy unless copied from another project.',
      inputSchema: {
        name: nameSchema(LIMITS.projectName),
        description: z.string().max(LIMITS.projectDescription).optional(),
        copyStagesFrom: z.string().optional().describe('Slug of a project whose stages to copy'),
      },
    },
    ({ name, description, copyStagesFrom }) =>
      run(() => createProject(ctx, { name, description: description ?? '', copyStagesFrom })),
  )

  const stageOp = z.discriminatedUnion('op', [
    z.object({
      op: z.literal('add'),
      name: nameSchema(LIMITS.stageName),
      after: z.string().optional(),
    }),
    z.object({ op: z.literal('rename'), stage: z.string(), name: nameSchema(LIMITS.stageName) }),
    z.object({
      op: z.literal('move'),
      stage: z.string(),
      before: z.string().optional(),
      after: z.string().optional(),
    }),
    z.object({ op: z.literal('archive'), stage: z.string() }),
    z.object({ op: z.literal('restore'), stage: z.string() }),
  ])
  server.registerTool(
    'manage_stages',
    {
      title: 'Manage stages',
      description:
        'Add, rename, reorder, archive, or restore stages (project owners only). All ops apply together or not at all. Stages are referenced by name.',
      inputSchema: { project, ops: z.array(stageOp).min(1).max(50) },
    },
    ({ project: ref, ops }) => run(() => manageStages(ctx, ref, ops as StageOp[])),
  )
}
