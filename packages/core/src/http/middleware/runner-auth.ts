import type { MiddlewareHandler } from 'hono'

import { authenticateRunner } from '../../services/runners.service'
import type { AppEnv } from '../env'
import { errorResponse } from '../errors'
import { bearerToken } from './auth'

/** Runner endpoints accept only a runner credential, never a person's session or token. */
export const runnerAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const deps = c.get('deps')
  const token = bearerToken(c.req.header('authorization'))
  const runner = token
    ? await authenticateRunner(deps.database.db, deps.config, token, deps.now())
    : null
  if (!runner) return errorResponse(c, 'unauthenticated', 'Runner credential is missing or revoked')
  c.set('runner', runner)
  return next()
}
