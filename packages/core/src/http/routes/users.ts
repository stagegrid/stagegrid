import {
  changePasswordInput,
  createTokenInput,
  createUserInput,
  updateMeInput,
  updateUserInput,
} from '@stagegrid/shared'
import { Hono } from 'hono'

import { changePassword } from '../../services/auth.service'
import * as tokens from '../../services/tokens.service'
import * as users from '../../services/users.service'
import { body, requireAuth, serviceCtx } from '../context'
import type { AppEnv } from '../env'

export const userRoutes = new Hono<AppEnv>()
  .get('/me', async (c) => {
    requireAuth(c)
    return c.json(await users.getMe(serviceCtx(c)))
  })
  .patch('/me', async (c) =>
    c.json(await users.updateMe(serviceCtx(c), await body(c, updateMeInput))),
  )
  .post('/me/password', async (c) => {
    const auth = requireAuth(c)
    await changePassword(serviceCtx(c), auth.sessionId, await body(c, changePasswordInput))
    return c.body(null, 204)
  })
  .get('/me/tokens', async (c) => c.json(await tokens.listTokens(serviceCtx(c))))
  .post('/me/tokens', async (c) =>
    c.json(await tokens.createToken(serviceCtx(c), await body(c, createTokenInput)), 201),
  )
  .delete('/me/tokens/:id', async (c) => {
    await tokens.revokeToken(serviceCtx(c), c.req.param('id'))
    return c.body(null, 204)
  })
  .get('/users/directory', async (c) => c.json(await users.listDirectory(serviceCtx(c))))
  .get('/admin/users', async (c) => c.json(await users.listUsers(serviceCtx(c))))
  .post('/admin/users', async (c) =>
    c.json(await users.inviteUser(serviceCtx(c), await body(c, createUserInput)), 201),
  )
  .patch('/admin/users/:id', async (c) =>
    c.json(
      await users.updateUser(serviceCtx(c), c.req.param('id'), await body(c, updateUserInput)),
    ),
  )
  .post('/admin/users/:id/invite-link', async (c) =>
    c.json(await users.createInviteLink(serviceCtx(c), c.req.param('id'))),
  )
  .post('/admin/users/:id/reset-link', async (c) =>
    c.json(await users.createResetLink(serviceCtx(c), c.req.param('id'))),
  )
