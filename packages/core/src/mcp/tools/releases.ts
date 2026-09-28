import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { dateSchema, nameSchema, releaseItemInput, releasePhasesInput } from '@stagegrid/shared'
import { z } from 'zod'

import type { ServiceContext } from '../../services/context'
import {
  addReleaseItems,
  createRelease,
  getRelease,
  listReleases,
  markReleased,
  removeReleaseItems,
  setReleasePhases,
  updateRelease,
} from '../../services/releases.service'
import { run } from '../result'

const project = z.string().describe('Project slug (from list_projects) or id')
const release = z.string().describe('Release name (e.g. "v1.2") or id')
const CODE = { skip: '-', todo: 'T', doing: 'P', done: 'D' } as const

export function registerReleaseTools(server: McpServer, ctx: ServiceContext): void {
  server.registerTool(
    'list_releases',
    {
      title: 'List releases',
      description:
        'Releases of a project with target date, status (planned / in_progress / at_risk / released / cancelled), percent done, and risk count.',
      inputSchema: { project, status: z.enum(['active', 'released', 'cancelled']).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project: ref, status }) =>
      run(async () =>
        (await listReleases(ctx, ref, { status })).map((r) => ({
          name: r.name,
          targetDate: r.targetDate,
          status: r.displayStatus,
          percent: r.stats.percent,
          riskCount: r.riskCount,
          items: r.itemCount,
        })),
      ),
  )

  server.registerTool(
    'get_release',
    {
      title: 'Get release',
      description:
        'One release: phases (e.g. Dev/SIT/UAT, freeze = work must be done before it starts), stats, risks, and scope as compact rows "Path [new|change] | D P - T" where "-" means that stage is not part of the release. Released releases return their snapshot.',
      inputSchema: { project, release },
      annotations: { readOnlyHint: true },
    },
    ({ project: ref, release: rel }) =>
      run(async () => {
        const r = await getRelease(ctx, ref, rel)
        const rows = r.scope
          .filter((i) => i.kind)
          .map(
            (i) =>
              `${i.path} [${i.kind}] | ${r.stages.map((s) => (i.cells[s.id] ? CODE[i.cells[s.id]!.status] : '·')).join(' ')}`,
          )
        return {
          name: r.name,
          targetDate: r.targetDate,
          status: r.displayStatus,
          stats: r.stats,
          phases: r.phases,
          risks: r.risks.map((x) => x.message),
          stages: r.stages.map((s) => s.name),
          legend: '· = stage not in this release',
          scope: rows,
          snapshot: r.snapshot,
        }
      }),
  )

  server.registerTool(
    'create_release',
    {
      title: 'Create release',
      description:
        "Create a release with a target date. Phases default to the project's (usually Dev, SIT (freeze), UAT). Items can be added in the same call.",
      inputSchema: {
        project,
        name: nameSchema(100),
        targetDate: dateSchema,
        description: z.string().max(2000).optional(),
        phases: releasePhasesInput.optional(),
        items: z.array(releaseItemInput).optional().describe('Same as add_release_items'),
      },
    },
    ({ project: ref, name, targetDate, description, phases, items }) =>
      run(async () => {
        const r = await createRelease(ctx, ref, {
          name,
          targetDate,
          description: description ?? '',
          phases,
        })
        if (items?.length) await addReleaseItems(ctx, ref, r.id, { items, dryRun: false })
        return getRelease(ctx, ref, r.id)
      }),
  )

  server.registerTool(
    'update_release',
    {
      title: 'Update release',
      description:
        'Rename a release, change its target date or description, or replace its phases (list in order; at most one freeze).',
      inputSchema: {
        project,
        release,
        name: nameSchema(100).optional(),
        targetDate: dateSchema.optional(),
        description: z.string().max(2000).optional(),
        phases: releasePhasesInput.optional(),
      },
    },
    ({ project: ref, release: rel, phases, ...fields }) =>
      run(async () => {
        let r = await updateRelease(ctx, ref, rel, fields)
        if (phases) r = await setReleasePhases(ctx, ref, r.id, phases)
        return r
      }),
  )

  server.registerTool(
    'add_release_items',
    {
      title: 'Add items to a release',
      description:
        'Add items to a release. kind "new" = the item is built in this release (all stages). kind "change" = an existing item is modified; list the stages to redo — those cells are reopened if done. Use dryRun: true first and show the user which cells will be reopened.',
      inputSchema: {
        project,
        release,
        items: z.array(releaseItemInput).min(1),
        dryRun: z.boolean().optional(),
      },
    },
    ({ project: ref, release: rel, items, dryRun }) =>
      run(() => addReleaseItems(ctx, ref, rel, { items, dryRun: dryRun ?? false })),
  )

  server.registerTool(
    'remove_release_items',
    {
      title: 'Remove items from a release',
      description: 'Take items out of a release. Cells already reopened stay as they are.',
      inputSchema: { project, release, items: z.array(z.string()).min(1).describe('Item paths') },
    },
    ({ project: ref, release: rel, items }) => run(() => removeReleaseItems(ctx, ref, rel, items)),
  )

  server.registerTool(
    'mark_release_released',
    {
      title: 'Mark release as released',
      description:
        'Record that the release went live (project owners only). Stores a snapshot and locks the scope. Needs force: true if some cells are not done. Ask the user first.',
      inputSchema: { project, release, force: z.boolean().optional() },
      annotations: { destructiveHint: true },
    },
    ({ project: ref, release: rel, force }) =>
      run(async () => {
        const r = await markReleased(ctx, ref, rel, { force })
        return { name: r.name, status: r.status, snapshot: r.snapshot }
      }),
  )
}
