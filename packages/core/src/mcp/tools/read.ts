import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { compactBoard } from '../../domain/compact-board'
import { buildPathIndex } from '../../domain/refs'
import {
  getActivity,
  getBoard,
  getCellByRefs,
  getSummary,
  listStaleCells,
} from '../../services/board.service'
import type { ServiceContext } from '../../services/context'
import { listProjects } from '../../services/projects.service'
import { refError } from '../../services/refs'
import { run } from '../result'

const project = z.string().describe('Project slug (from list_projects) or id')
const RO = { readOnlyHint: true, openWorldHint: false } as const

export function registerReadTools(server: McpServer, ctx: ServiceContext): void {
  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Projects you can access, with your role and progress. Start here to find a project slug.',
      inputSchema: {
        includeArchived: z.boolean().optional().describe('Also list archived projects'),
      },
      annotations: RO,
    },
    ({ includeArchived }) =>
      run(async () => {
        const active = await listProjects(ctx)
        const archived = includeArchived ? await listProjects(ctx, { archived: true }) : []
        return [...active, ...archived].map((p) => ({
          slug: p.slug,
          name: p.name,
          role: p.role,
          archived: p.archivedAt !== null,
          percent: p.stats.percent,
          stats: p.stats,
        }))
      }),
  )

  server.registerTool(
    'get_board',
    {
      title: 'Get board',
      description:
        'The project grid: every item (as a " > " path) and its status in each stage. Use format "compact" (default) — one line per item like "Settings > Users | D D P T". Legend is included. Call this before changing anything.',
      inputSchema: {
        project,
        format: z.enum(['compact', 'full']).optional().describe('compact (default) or full JSON'),
        path: z.string().optional().describe('Only this item and its descendants, e.g. "Settings"'),
      },
      annotations: RO,
    },
    ({ project: ref, format, path }) =>
      run(async () => {
        const board = await getBoard(ctx, ref)
        const index = buildPathIndex(board.items)
        let under: string | undefined
        if (path) {
          const r = index.resolve(path)
          if (!r.ok) throw refError('item', path, r)
          under = r.id
        }
        if (format !== 'full') return compactBoard(board, under)
        const stageName = new Map(board.stages.map((s) => [s.id, s.name]))
        return {
          project: board.project,
          stages: board.stages.map((s) => s.name),
          items: board.items
            .filter(
              (i) =>
                !under ||
                i.id === under ||
                index.pathOf(i.id).startsWith(`${index.pathOf(under)} > `),
            )
            .map((i) => ({
              path: index.pathOf(i.id),
              cells: Object.fromEntries(
                Object.entries(board.cells[i.id] ?? {}).map(([stageId, c]) => [
                  stageName.get(stageId),
                  { status: c.status, rework: c.rework, stale: c.stale },
                ]),
              ),
            })),
          stats: board.stats,
        }
      }),
  )

  server.registerTool(
    'get_summary',
    {
      title: 'Get summary',
      description:
        'Progress numbers for a project: overall and per stage (all/open/doing/done/percent), rework, and how many cells need an update.',
      inputSchema: { project },
      annotations: RO,
    },
    ({ project: ref }) => run(() => getSummary(ctx, ref)),
  )

  server.registerTool(
    'get_cell',
    {
      title: 'Get cell',
      description:
        'One item × stage cell with its full history (who changed what, when, why), work rounds, and rework count.',
      inputSchema: {
        project,
        item: z.string().describe('Item path like "Settings > Users" or id'),
        stage: z.string().describe('Stage name like "QA" or id'),
      },
      annotations: RO,
    },
    ({ project: ref, item, stage }) => run(() => getCellByRefs(ctx, ref, item, stage)),
  )

  server.registerTool(
    'list_stale_cells',
    {
      title: 'List cells that need an update',
      description:
        'Cells whose data is probably out of date: "doing" for longer than the project\'s stale days, or past their planned end and not done. Use when the user asks what is stuck, then offer to check each one with them or their tracker.',
      inputSchema: { project },
      annotations: RO,
    },
    ({ project: ref }) => run(() => listStaleCells(ctx, ref)),
  )

  server.registerTool(
    'get_recent_changes',
    {
      title: 'Get recent changes',
      description:
        'What changed in a project (status changes, new items, stage edits…), newest first. Default: the last 7 days.',
      inputSchema: {
        project,
        since: z.iso
          .datetime({ offset: true })
          .optional()
          .describe('ISO 8601 with offset; default 7 days ago'),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: RO,
    },
    ({ project: ref, since, limit }) =>
      run(async () =>
        (await getActivity(ctx, ref, { since: since ? new Date(since) : undefined, limit })).map(
          (a) => ({
            at: a.createdAt,
            action: a.action,
            by: `${a.actor.name} (${a.actor.via})`,
            before: a.before,
            after: a.after,
          }),
        ),
      ),
  )
}
