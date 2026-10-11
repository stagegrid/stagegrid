import type {
  ClaimedRunDto,
  QueuedRunDto,
  RunDto,
  RunnerEnrollmentDto,
  TaskDetailDto,
} from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { APP_ORIGIN, browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()

describe('runs and runners API', () => {
  it('takes a task from Start to submitted work through the runner endpoints', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    await b.post('/api/v1/projects', { name: 'Pilot' })
    await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Login' }] })
    const board = (await (await b.get('/api/v1/projects/pilot/board')).json()) as {
      project: { id: string }
      items: { id: string }[]
      stages: { id: string; name: string }[]
      cells: Record<string, Record<string, { id: string }>>
    }
    const stage = board.stages.find((s) => s.name === 'Implement')!
    const cellId = board.cells[board.items[0]!.id]![stage.id]!.id
    const base = '/api/v1/projects/pilot'
    await b.put(`${base}/cells/${cellId}/progress-mode`, { mode: 'tasks' })
    const mali = (await (
      await b.post(`${base}/employees`, {
        displayName: 'Mali',
        role: 'dev',
        provider: 'claude_code',
      })
    ).json()) as { id: string }
    const task = (await (
      await b.post(`${base}/tasks`, { cellId, title: 'Email login', employeeId: mali.id })
    ).json()) as TaskDetailDto
    const pinned = (await (
      await b.post(`${base}/tasks/${task.id}/context`, { decisions: ['Email only'] })
    ).json()) as { revisionId: string }
    const ready = (await (
      await b.post(`${base}/tasks/${task.id}/actions`, { action: 'mark_ready', expectedVersion: 1 })
    ).json()) as TaskDetailDto

    const startBody = {
      expectedVersion: ready.version,
      contextRevisionId: pinned.revisionId,
      idempotencyKey: 'ui-1',
    }
    const noRunner = await b.post(`${base}/tasks/${task.id}/runs`, startBody)
    expect(noRunner.status).toBe(409)
    expect(await noRunner.json()).toMatchObject({
      error: { details: { code: 'runner_unavailable' } },
    })

    // Enrol a runner with a one-time token.
    const enrollment = (await (
      await b.post('/api/v1/runner-enrollments', {
        name: 'build-box',
        projectIds: [board.project.id],
      })
    ).json()) as RunnerEnrollmentDto
    const enrolled = await b.post('/api/v1/runner/enroll', {
      token: enrollment.token,
      providers: ['claude_code'],
    })
    expect(enrolled.status).toBe(201)
    const { credential } = (await enrolled.json()) as { credential: string }
    expect(
      (await b.post('/api/v1/runner/enroll', { token: enrollment.token, providers: [] })).status,
    ).toBe(401)

    const runner = (path: string, init: { method?: string; body?: unknown } = {}) =>
      app.request(`/api/v1/runner${path}`, {
        method: init.method ?? (init.body ? 'POST' : 'GET'),
        headers: {
          authorization: `Bearer ${credential}`,
          'content-type': 'application/json',
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      })

    const started = await b.post(`${base}/tasks/${task.id}/runs`, startBody)
    expect(started.status).toBe(201)
    const run = (await started.json()) as RunDto

    const queue = (await (await runner('/queue')).json()) as QueuedRunDto[]
    expect(queue.map((q) => q.id)).toEqual([run.id])
    const claimRes = await runner(`/runs/${run.id}/claim`, { body: { idempotencyKey: 'c1' } })
    expect(claimRes.status).toBe(200)
    const claim = (await claimRes.json()) as ClaimedRunDto
    expect(claim.context.manifest.decisions).toEqual(['Email only'])
    const t = claim.run.fencingToken

    const event = await runner(`/runs/${run.id}/events`, {
      body: {
        eventId: 'e1',
        sequence: 1,
        type: 'progress',
        payload: { message: 'hi' },
        fencingToken: t,
      },
    })
    expect(await event.json()).toMatchObject({ duplicate: false })
    expect(
      (await runner(`/runs/${run.id}/heartbeat`, { body: { fencingToken: t + 5 } })).status,
    ).toBe(409)
    const done = await runner(`/runs/${run.id}/complete`, {
      body: { fencingToken: t, idempotencyKey: 'd1', outcome: 'succeeded', summary: 'Done' },
    })
    expect(await done.json()).toMatchObject({ state: 'succeeded' })

    const after = (await (await b.get(`${base}/tasks/${task.id}`)).json()) as TaskDetailDto
    expect(after.state).toBe('ready_for_acceptance')
    expect(after.run).toMatchObject({ state: 'succeeded', runnerName: 'build-box' })
    const history = (await (await b.get(`${base}/tasks/${task.id}/runs`)).json()) as RunDto[]
    expect(history).toHaveLength(1)
  })

  it('keeps people and runners apart', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    expect((await b.get('/api/v1/runner/queue')).status).toBe(401)
    const token = (
      (await (await b.post('/api/v1/me/tokens', { name: 'pat' })).json()) as { token: string }
    ).token
    const asPat = await app.request('/api/v1/runner/queue', {
      headers: { authorization: `Bearer ${token}`, origin: APP_ORIGIN },
    })
    expect(asPat.status).toBe(401)
    const asRunner = await app.request('/api/v1/projects', {
      headers: { authorization: 'Bearer sg_runner_nope' },
    })
    expect(asRunner.status).toBe(401)
    expect((await b.get('/api/v1/runners')).status).toBe(200)
  })
})
