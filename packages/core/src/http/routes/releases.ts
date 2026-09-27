import {
  addReleaseItemsInput,
  createReleaseInput,
  markReleasedInput,
  releaseNoteInput,
  releasePhasesInput,
  updateReleaseInput,
} from '@stagegrid/shared'
import { Hono } from 'hono'
import { z } from 'zod'

import * as releases from '../../services/releases.service'
import { body, serviceCtx } from '../context'
import type { AppEnv } from '../env'

const base = '/projects/:ref/releases'

export const releaseRoutes = new Hono<AppEnv>()
  .get(base, async (c) => {
    const status = z
      .enum(['active', 'released', 'cancelled'])
      .optional()
      .parse(c.req.query('status'))
    return c.json(await releases.listReleases(serviceCtx(c), c.req.param('ref'), { status }))
  })
  .post(base, async (c) =>
    c.json(
      await releases.createRelease(
        serviceCtx(c),
        c.req.param('ref'),
        await body(c, createReleaseInput),
      ),
      201,
    ),
  )
  .get(`${base}/:id`, async (c) =>
    c.json(await releases.getRelease(serviceCtx(c), c.req.param('ref'), c.req.param('id'))),
  )
  .patch(`${base}/:id`, async (c) =>
    c.json(
      await releases.updateRelease(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, updateReleaseInput),
      ),
    ),
  )
  .delete(`${base}/:id`, async (c) => {
    await releases.deleteRelease(serviceCtx(c), c.req.param('ref'), c.req.param('id'))
    return c.body(null, 204)
  })
  .put(`${base}/:id/phases`, async (c) => {
    const { phases } = await body(c, z.object({ phases: releasePhasesInput }))
    return c.json(
      await releases.setReleasePhases(serviceCtx(c), c.req.param('ref'), c.req.param('id'), phases),
    )
  })
  .post(`${base}/:id/items`, async (c) =>
    c.json(
      await releases.addReleaseItems(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, addReleaseItemsInput),
      ),
    ),
  )
  .patch(`${base}/:id/items/:itemId`, async (c) => {
    const { note } = await body(c, releaseNoteInput)
    await releases.updateReleaseItemNote(
      serviceCtx(c),
      c.req.param('ref'),
      c.req.param('id'),
      c.req.param('itemId'),
      note,
    )
    return c.body(null, 204)
  })
  .delete(`${base}/:id/items/:itemId`, async (c) =>
    c.json(
      await releases.removeReleaseItems(serviceCtx(c), c.req.param('ref'), c.req.param('id'), [
        c.req.param('itemId'),
      ]),
    ),
  )
  .post(`${base}/:id/release`, async (c) =>
    c.json(
      await releases.markReleased(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, markReleasedInput),
      ),
    ),
  )
  .post(`${base}/:id/cancel`, async (c) => {
    await releases.cancelRelease(serviceCtx(c), c.req.param('ref'), c.req.param('id'))
    return c.body(null, 204)
  })
