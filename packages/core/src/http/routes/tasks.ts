import {
  createTaskInput,
  listTasksQuery,
  setCellProgressModeInput,
  taskActionInput,
  updateTaskInput,
} from '@stagegrid/shared'
import { Hono } from 'hono'

import * as tasks from '../../services/tasks.service'
import { body, serviceCtx } from '../context'
import type { AppEnv } from '../env'

const base = '/projects/:ref/tasks'

export const taskRoutes = new Hono<AppEnv>()
  .get(base, async (c) => {
    const query = listTasksQuery.parse(c.req.query())
    return c.json(await tasks.listTasks(serviceCtx(c), c.req.param('ref'), query))
  })
  .post(base, async (c) =>
    c.json(
      await tasks.createTask(serviceCtx(c), c.req.param('ref'), await body(c, createTaskInput)),
      201,
    ),
  )
  .get(`${base}/:id`, async (c) =>
    c.json(await tasks.getTask(serviceCtx(c), c.req.param('ref'), c.req.param('id'))),
  )
  .patch(`${base}/:id`, async (c) =>
    c.json(
      await tasks.updateTask(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, updateTaskInput),
      ),
    ),
  )
  .post(`${base}/:id/actions`, async (c) =>
    c.json(
      await tasks.transitionTask(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, taskActionInput),
      ),
    ),
  )
  .put('/projects/:ref/cells/:cellId/progress-mode', async (c) =>
    c.json(
      await tasks.setCellProgressMode(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('cellId'),
        (await body(c, setCellProgressModeInput)).mode,
      ),
    ),
  )
