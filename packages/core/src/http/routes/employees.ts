import { createContextInput, createEmployeeInput, updateEmployeeInput } from '@stagegrid/shared'
import { Hono } from 'hono'

import * as employees from '../../services/employees.service'
import * as questions from '../../services/questions.service'
import * as contexts from '../../services/tasks.service'
import { body, serviceCtx } from '../context'
import type { AppEnv } from '../env'

const base = '/projects/:ref/employees'

export const employeeRoutes = new Hono<AppEnv>()
  .get(base, async (c) =>
    c.json(
      await employees.listEmployees(serviceCtx(c), c.req.param('ref'), {
        includeArchived: c.req.query('archived') === 'true',
      }),
    ),
  )
  .post(base, async (c) =>
    c.json(
      await employees.createEmployee(
        serviceCtx(c),
        c.req.param('ref'),
        await body(c, createEmployeeInput),
      ),
      201,
    ),
  )
  .get(`${base}/:id`, async (c) =>
    c.json(await employees.getEmployee(serviceCtx(c), c.req.param('ref'), c.req.param('id'))),
  )
  .patch(`${base}/:id`, async (c) =>
    c.json(
      await employees.updateEmployee(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, updateEmployeeInput),
      ),
    ),
  )
  .post(`${base}/:id/archive`, async (c) =>
    c.json(
      await employees.setEmployeeArchived(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        true,
      ),
    ),
  )
  .post(`${base}/:id/restore`, async (c) =>
    c.json(
      await employees.setEmployeeArchived(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        false,
      ),
    ),
  )
  .get('/projects/:ref/tasks/:id/context', async (c) =>
    c.json(
      await contexts.getContext(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        c.req.query('revisionId'),
      ),
    ),
  )
  .post('/projects/:ref/tasks/:id/context', async (c) =>
    c.json(
      await questions.pinContextAndRelease(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, createContextInput),
      ),
      201,
    ),
  )
