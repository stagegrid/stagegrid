import {
  acceptTaskInput,
  answerQuestionInput,
  askQuestionsInput,
  cancelRunInput,
  claimRunInput,
  completeRunInput,
  createEnrollmentInput,
  enrollRunnerInput,
  fencedInput,
  reportCapacityInput,
  runEventInput,
  runnerSelfInput,
  startRunInput,
  updateRunnerInput,
} from '@stagegrid/shared'
import { Hono } from 'hono'
import { z } from 'zod'

import { AppError } from '../../errors'
import * as acceptance from '../../services/acceptance.service'
import * as questions from '../../services/questions.service'
import * as runners from '../../services/runners.service'
import * as runs from '../../services/runs.service'
import * as thread from '../../services/thread.service'
import { body, clientIp, serviceCtx } from '../context'
import type { AppEnv } from '../env'
import { runnerAuth } from '../middleware/runner-auth'

const MAX_WAIT_SECONDS = 25
const POLL_MS = 1000

export const runRoutes = new Hono<AppEnv>()
  // ---- people
  .get('/projects/:ref/tasks/:id/runs', async (c) =>
    c.json(await runs.listRuns(serviceCtx(c), c.req.param('ref'), c.req.param('id'))),
  )
  .post('/projects/:ref/tasks/:id/runs', async (c) =>
    c.json(
      await runs.startRun(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, startRunInput),
      ),
      201,
    ),
  )
  .post('/projects/:ref/runs/:runId/cancel', async (c) =>
    c.json(
      await runs.cancelRun(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('runId'),
        (await body(c, cancelRunInput)).reason,
      ),
    ),
  )
  .get('/projects/:ref/tasks/:id/questions', async (c) =>
    c.json(await questions.listBatches(serviceCtx(c), c.req.param('ref'), c.req.param('id'))),
  )
  .post('/projects/:ref/questions/:id/answer', async (c) =>
    c.json(
      await questions.answerQuestion(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, answerQuestionInput),
      ),
    ),
  )
  .post('/projects/:ref/tasks/:id/accept', async (c) =>
    c.json(
      await acceptance.acceptTask(
        serviceCtx(c),
        c.req.param('ref'),
        c.req.param('id'),
        await body(c, acceptTaskInput),
      ),
    ),
  )
  .get('/projects/:ref/tasks/:id/submissions', async (c) =>
    c.json(await acceptance.listSubmissions(serviceCtx(c), c.req.param('ref'), c.req.param('id'))),
  )
  .get('/projects/:ref/tasks/:id/thread', async (c) =>
    c.json(await thread.getThread(serviceCtx(c), c.req.param('ref'), c.req.param('id'))),
  )
  .get('/projects/:ref/attention', async (c) =>
    c.json(await thread.getAttention(serviceCtx(c), c.req.param('ref'))),
  )
  // ---- admins
  .post('/runner-enrollments', async (c) =>
    c.json(
      await runners.createEnrollment(serviceCtx(c), await body(c, createEnrollmentInput)),
      201,
    ),
  )
  .get('/runners', async (c) => c.json(await runners.listRunners(serviceCtx(c))))
  .patch('/runners/:id', async (c) =>
    c.json(
      await runners.updateRunner(
        serviceCtx(c),
        c.req.param('id'),
        await body(c, updateRunnerInput),
      ),
    ),
  )
  .post('/runners/:id/revoke', async (c) => {
    await runners.revokeRunner(serviceCtx(c), c.req.param('id'))
    return c.body(null, 204)
  })
  // ---- runners
  .post('/runner/enroll', async (c) => {
    const deps = c.get('deps')
    const wait = deps.publicLimiter.hit(`runner-enroll:${clientIp(c)}`)
    if (wait > 0) {
      c.header('Retry-After', String(wait))
      throw new AppError('rate_limited', 'Too many attempts. Try again later.')
    }
    return c.json(await runners.enrollRunner(serviceCtx(c), await body(c, enrollRunnerInput)), 201)
  })
  .use('/runner/*', runnerAuth)
  .put('/runner/self', async (c) => {
    await runners.updateRunnerSelf(serviceCtx(c), c.get('runner')!, await body(c, runnerSelfInput))
    return c.body(null, 204)
  })
  .put('/runner/capacity', async (c) => {
    await runners.reportCapacity(
      serviceCtx(c),
      c.get('runner')!,
      await body(c, reportCapacityInput),
    )
    return c.body(null, 204)
  })
  .get('/runner/queue', async (c) => {
    const runner = c.get('runner')!
    const ctx = serviceCtx(c)
    const wait = Math.min(
      z.coerce.number().int().min(0).catch(0).parse(c.req.query('wait')),
      MAX_WAIT_SECONDS,
    )
    const deadline = Date.now() + wait * 1000
    for (;;) {
      await runs.expireLeases(ctx)
      const queued = await runs.runnerQueue(ctx, runner)
      if (queued.length > 0 || Date.now() >= deadline) return c.json(queued)
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  })
  .post('/runner/runs/:id/claim', async (c) =>
    c.json(
      await runs.claimRun(
        serviceCtx(c),
        c.get('runner')!,
        c.req.param('id'),
        await body(c, claimRunInput),
      ),
    ),
  )
  .post('/runner/runs/:id/heartbeat', async (c) =>
    c.json(
      await runs.heartbeatRun(
        serviceCtx(c),
        c.get('runner')!,
        c.req.param('id'),
        (await body(c, fencedInput)).fencingToken,
      ),
    ),
  )
  .post('/runner/runs/:id/events', async (c) =>
    c.json(
      await runs.recordRunEvent(
        serviceCtx(c),
        c.get('runner')!,
        c.req.param('id'),
        await body(c, runEventInput),
      ),
    ),
  )
  .post('/runner/runs/:id/questions', async (c) =>
    c.json(
      await questions.askQuestions(
        serviceCtx(c),
        c.get('runner')!,
        c.req.param('id'),
        await body(c, askQuestionsInput),
      ),
      201,
    ),
  )
  .post('/runner/runs/:id/complete', async (c) =>
    c.json(
      await runs.completeRun(
        serviceCtx(c),
        c.get('runner')!,
        c.req.param('id'),
        await body(c, completeRunInput),
      ),
    ),
  )
