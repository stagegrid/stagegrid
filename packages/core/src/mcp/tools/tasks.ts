import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CELL_PROGRESS_MODES, LIMITS, TASK_ACTIONS, TASK_STATES } from '@stagegrid/shared'
import { z } from 'zod'

import { getCellByRefs } from '../../services/board.service'
import type { ServiceContext } from '../../services/context'
import { listEmployees } from '../../services/employees.service'
import {
  createTask,
  getContext,
  listTasks,
  setCellProgressMode,
  transitionTask,
} from '../../services/tasks.service'
import { run } from '../result'

const project = z.string().describe('Project slug (from list_projects) or id')
const item = z.string().describe('Item path, e.g. "Settings > Users"')
const stage = z.string().describe('Stage name, e.g. "Implement"')

export function registerTaskTools(server: McpServer, ctx: ServiceContext): void {
  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'Tasks of a project with their state, version, owner and the item × stage cell they belong to. `actions` lists what can be done next with task_action. Cells with `progressMode: "tasks"` get their status from these tasks.',
      inputSchema: { project, state: z.enum(TASK_STATES).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ project: ref, state }) =>
      run(async () =>
        (await listTasks(ctx, ref, { state })).map((t) => ({
          id: t.id,
          title: t.title,
          item: t.itemPath,
          stage: t.stageName,
          state: t.state,
          version: t.version,
          required: t.required,
          owner: t.owner?.name ?? null,
          actions: t.actions,
        })),
      ),
  )

  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description:
        'Add a draft task to an item × stage cell. The cell must be in task mode (set_cell_progress_mode). Only required tasks count towards the cell status.',
      inputSchema: {
        project,
        item,
        stage,
        title: z.string().min(1).max(LIMITS.taskTitle),
        scope: z.string().max(LIMITS.taskScope).optional(),
        acceptanceCriteria: z.array(z.string().max(LIMITS.acceptanceCriterion)).optional(),
        required: z.boolean().optional(),
      },
    },
    ({ project: ref, item: itemRef, stage: stageRef, ...rest }) =>
      run(async () => {
        const cell = await getCellByRefs(ctx, ref, itemRef, stageRef)
        const t = await createTask(ctx, ref, {
          cellId: cell.id,
          title: rest.title,
          scope: rest.scope ?? '',
          acceptanceCriteria: rest.acceptanceCriteria ?? [],
          required: rest.required ?? true,
          ownerUserId: null,
          employeeId: null,
        })
        return { id: t.id, state: t.state, version: t.version }
      }),
  )

  server.registerTool(
    'task_action',
    {
      title: 'Move a task',
      description:
        'Move a task along its states: mark_ready, start, submit, accept, request_changes, reopen, cancel, restore. Pass the task `version` from list_tasks. request_changes, reopen and cancel need a `reason`. Accepting is the person who owns the decision: only do it when the user said so.',
      inputSchema: {
        project,
        task: z.string().describe('Task id from list_tasks'),
        action: z.enum(TASK_ACTIONS),
        version: z.number().int().min(1),
        reason: z.string().max(LIMITS.reason).optional(),
      },
    },
    ({ project: ref, task, action, version, reason }) =>
      run(async () => {
        const t = await transitionTask(ctx, ref, task, {
          action,
          expectedVersion: version,
          reason,
        })
        const detail = await getCellByRefs(ctx, ref, t.itemPath, t.stageName)
        return {
          id: t.id,
          state: t.state,
          version: t.version,
          actions: t.actions,
          cellStatus: detail.status,
        }
      }),
  )

  server.registerTool(
    'set_cell_progress_mode',
    {
      title: 'Set how a cell tracks progress',
      description:
        '`tasks`: the cell status is derived from its required tasks and can no longer be set with apply_changes. `manual`: back to setting the status directly (project owners only). Ask the user before switching a cell.',
      inputSchema: { project, item, stage, mode: z.enum(CELL_PROGRESS_MODES) },
    },
    ({ project: ref, item: itemRef, stage: stageRef, mode }) =>
      run(async () => {
        const cell = await getCellByRefs(ctx, ref, itemRef, stageRef)
        return setCellProgressMode(ctx, ref, cell.id, mode)
      }),
  )

  server.registerTool(
    'list_employees',
    {
      title: 'List AI employees',
      description:
        'The named AI employees of a project with their role and runtime (provider, model). Use their ids as `employeeId` when assigning work.',
      inputSchema: { project },
      annotations: { readOnlyHint: true },
    },
    ({ project: ref }) =>
      run(async () =>
        (await listEmployees(ctx, ref)).map((e) => ({
          id: e.id,
          name: e.displayName,
          role: e.role,
          provider: e.provider,
          model: e.model,
        })),
      ),
  )

  server.registerTool(
    'get_task_context',
    {
      title: "Get a task's pinned context",
      description:
        'The immutable context pinned for a task: document revisions, source snapshots and confirmed decisions. `outdated` lists documents that changed after pinning; the pinned content itself never changes.',
      inputSchema: { project, task: z.string().describe('Task id from list_tasks') },
      annotations: { readOnlyHint: true },
    },
    ({ project: ref, task }) => run(async () => getContext(ctx, ref, task)),
  )
}
