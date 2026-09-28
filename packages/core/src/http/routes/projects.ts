import {
  addMemberInput,
  changesInput,
  createItemsInput,
  createProjectInput,
  createStageInput,
  moveItemInput,
  moveStageInput,
  renameItemInput,
  renameStageInput,
  updateMemberInput,
  updateProjectInput,
} from '@stagegrid/shared'
import { Hono } from 'hono'
import { z } from 'zod'

import * as board from '../../services/board.service'
import { applyChanges } from '../../services/changes.service'
import { exportCsv, exportJson } from '../../services/export.service'
import * as items from '../../services/items.service'
import * as members from '../../services/members.service'
import * as projects from '../../services/projects.service'
import * as stages from '../../services/stages.service'
import { body, serviceCtx } from '../context'
import type { AppEnv } from '../env'

const archivedQuery = z.enum(['true', 'false']).optional()

export const projectRoutes = new Hono<AppEnv>()
  .get('/projects', async (c) =>
    c.json(
      await projects.listProjects(serviceCtx(c), {
        archived: archivedQuery.parse(c.req.query('archived')) === 'true',
      }),
    ),
  )
  .post('/projects', async (c) =>
    c.json(await projects.createProject(serviceCtx(c), await body(c, createProjectInput)), 201),
  )
  .get('/projects/:ref', async (c) =>
    c.json(await projects.getProject(serviceCtx(c), c.req.param('ref'))),
  )
  .patch('/projects/:ref', async (c) =>
    c.json(
      await projects.updateProject(
        serviceCtx(c),
        c.req.param('ref'),
        await body(c, updateProjectInput),
      ),
    ),
  )
  .post('/projects/:ref/archive', async (c) =>
    c.json(await projects.setProjectArchived(serviceCtx(c), c.req.param('ref'), true)),
  )
  .post('/projects/:ref/unarchive', async (c) =>
    c.json(await projects.setProjectArchived(serviceCtx(c), c.req.param('ref'), false)),
  )

  // members
  .get('/projects/:ref/members', async (c) =>
    c.json(await members.listMembers(serviceCtx(c), c.req.param('ref'))),
  )
  .post('/projects/:ref/members', async (c) => {
    await members.addMember(serviceCtx(c), c.req.param('ref'), await body(c, addMemberInput))
    return c.body(null, 204)
  })
  .patch('/projects/:ref/members/:userId', async (c) => {
    const { role } = await body(c, updateMemberInput)
    await members.updateMember(serviceCtx(c), c.req.param('ref'), c.req.param('userId'), role)
    return c.body(null, 204)
  })
  .delete('/projects/:ref/members/:userId', async (c) => {
    await members.removeMember(serviceCtx(c), c.req.param('ref'), c.req.param('userId'))
    return c.body(null, 204)
  })

  // stages
  .get('/projects/:ref/stages', async (c) =>
    c.json(await stages.listStages(serviceCtx(c), c.req.param('ref'))),
  )
  .post('/projects/:ref/stages', async (c) =>
    c.json(
      await stages.createStage(serviceCtx(c), c.req.param('ref'), await body(c, createStageInput)),
      201,
    ),
  )
  .patch('/projects/:ref/stages/:id', async (c) => {
    const { name } = await body(c, renameStageInput)
    return c.json(
      await stages.renameStage(serviceCtx(c), c.req.param('ref'), c.req.param('id'), name),
    )
  })
  .post('/projects/:ref/stages/:id/move', async (c) =>
    c.json(
      await stages.moveStage(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, moveStageInput),
      ),
    ),
  )
  .post('/projects/:ref/stages/:id/archive', async (c) =>
    c.json(
      await stages.setStageArchived(serviceCtx(c), c.req.param('ref'), c.req.param('id'), true),
    ),
  )
  .post('/projects/:ref/stages/:id/restore', async (c) =>
    c.json(
      await stages.setStageArchived(serviceCtx(c), c.req.param('ref'), c.req.param('id'), false),
    ),
  )

  // items
  .post('/projects/:ref/items', async (c) =>
    c.json(
      await items.createItems(serviceCtx(c), c.req.param('ref'), await body(c, createItemsInput)),
      201,
    ),
  )
  .patch('/projects/:ref/items/:id', async (c) => {
    const { name } = await body(c, renameItemInput)
    return c.json(
      await items.renameItem(serviceCtx(c), c.req.param('ref'), c.req.param('id'), name),
    )
  })
  .post('/projects/:ref/items/:id/move', async (c) =>
    c.json(
      await items.moveItem(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, moveItemInput),
      ),
    ),
  )
  .delete('/projects/:ref/items/:id', async (c) =>
    c.json(await items.deleteItem(serviceCtx(c), c.req.param('ref'), c.req.param('id'))),
  )

  // board & cells
  .get('/projects/:ref/board', async (c) =>
    c.json(await board.getBoard(serviceCtx(c), c.req.param('ref'))),
  )
  .get('/projects/:ref/summary', async (c) =>
    c.json(await board.getSummary(serviceCtx(c), c.req.param('ref'))),
  )
  .get('/projects/:ref/cells/:cellId', async (c) =>
    c.json(await board.getCellDetail(serviceCtx(c), c.req.param('ref'), c.req.param('cellId'))),
  )
  .post('/projects/:ref/changes', async (c) =>
    c.json(await applyChanges(serviceCtx(c), c.req.param('ref'), await body(c, changesInput))),
  )
  .get('/projects/:ref/activity', async (c) => {
    const q = z
      .object({
        since: z.iso.datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(c.req.query())
    return c.json(
      await board.getActivity(serviceCtx(c), c.req.param('ref'), {
        since: q.since ? new Date(q.since) : undefined,
        limit: q.limit,
      }),
    )
  })
  .get('/projects/:ref/export', async (c) => {
    const format = z.enum(['json', 'csv']).default('json').parse(c.req.query('format'))
    const ctx = serviceCtx(c)
    const ref = c.req.param('ref')
    const project = await projects.getProject(ctx, ref)
    const date = ctx.now().toISOString().slice(0, 10)
    if (format === 'csv') {
      c.header('Content-Disposition', `attachment; filename="${project.slug}-${date}.csv"`)
      return c.body(await exportCsv(ctx, ref), 200, { 'Content-Type': 'text/csv; charset=utf-8' })
    }
    c.header('Content-Disposition', `attachment; filename="${project.slug}-${date}.json"`)
    return c.json(await exportJson(ctx, ref))
  })
