import type {
  AttentionItemDto,
  ClaimedRunDto,
  QuestionBatchDto,
  RunDto,
  RunnerEnrollmentDto,
  TaskDetailDto,
  ThreadItemDto,
} from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()

describe('questions API', () => {
  it('lets an employee ask, a person answer, and the run continue with the answers', async () => {
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
      await b.post(`${base}/tasks`, { cellId, title: 'Bookings', employeeId: mali.id })
    ).json()) as TaskDetailDto
    const pinned = (await (
      await b.post(`${base}/tasks/${task.id}/context`, {
        decisions: ['Double booking is not allowed'],
      })
    ).json()) as { revisionId: string }
    const ready = (await (
      await b.post(`${base}/tasks/${task.id}/actions`, { action: 'mark_ready', expectedVersion: 1 })
    ).json()) as TaskDetailDto
    const enrollment = (await (
      await b.post('/api/v1/runner-enrollments', { name: 'box', projectIds: [board.project.id] })
    ).json()) as RunnerEnrollmentDto
    const { credential } = (await (
      await b.post('/api/v1/runner/enroll', { token: enrollment.token, providers: ['claude_code'] })
    ).json()) as { credential: string }
    const runner = (path: string, body?: unknown) =>
      app.request(`/api/v1/runner${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
    const run = (await (
      await b.post(`${base}/tasks/${task.id}/runs`, {
        expectedVersion: ready.version,
        contextRevisionId: pinned.revisionId,
        idempotencyKey: 'k',
      })
    ).json()) as RunDto
    const claim = (await (
      await runner(`/runs/${run.id}/claim`, { idempotencyKey: 'c1' })
    ).json()) as ClaimedRunDto

    const asked = await runner(`/runs/${run.id}/questions`, {
      questions: [
        { prompt: 'Reject the second request?', options: ['Yes', 'No'] },
        { prompt: 'Slot length?' },
      ],
      contextRevisionId: claim.context.revisionId,
      idempotencyKey: 'ask-1',
      fencingToken: claim.run.fencingToken,
    })
    expect(asked.status).toBe(201)
    const batch = (await asked.json()) as QuestionBatchDto
    expect(batch.questions).toHaveLength(2)

    const attention = (await (await b.get(`${base}/attention`)).json()) as AttentionItemDto[]
    expect(attention).toEqual([
      expect.objectContaining({ kind: 'question', taskTitle: 'Bookings' }),
    ])

    const first = await b.post(`${base}/questions/${batch.questions[0]!.id}/answer`, {
      answer: 'Yes',
      idempotencyKey: 'a1',
    })
    expect(first.status).toBe(200)
    expect(((await first.json()) as QuestionBatchDto).state).toBe('open')
    const dup = await b.post(`${base}/questions/${batch.questions[0]!.id}/answer`, {
      answer: 'No',
      idempotencyKey: 'a1b',
    })
    expect(dup.status).toBe(409)
    const last = await b.post(`${base}/questions/${batch.questions[1]!.id}/answer`, {
      answer: '30 minutes',
      idempotencyKey: 'a2',
    })
    expect(((await last.json()) as QuestionBatchDto).state).toBe('answered')

    const again = (await (
      await runner(`/runs/${run.id}/claim`, { idempotencyKey: 'c2' })
    ).json()) as ClaimedRunDto
    expect(again.answers).toEqual([
      { question: 'Reject the second request?', answer: 'Yes' },
      { question: 'Slot length?', answer: '30 minutes' },
    ])
    const thread = (await (
      await b.get(`${base}/tasks/${task.id}/thread`)
    ).json()) as ThreadItemDto[]
    expect(thread.filter((t) => t.kind === 'answer')).toHaveLength(2)
    const batches = (await (
      await b.get(`${base}/tasks/${task.id}/questions`)
    ).json()) as QuestionBatchDto[]
    expect(batches).toHaveLength(1)
  })
})
