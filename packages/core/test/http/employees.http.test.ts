import type { EmployeeDto, TaskContextDto, TaskDetailDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()

describe('employees and context API', () => {
  it('creates an employee, assigns a task, pins context and reports why it is not ready', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    await b.post('/api/v1/projects', { name: 'Pilot' })
    await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Login' }] })
    const board = (await (await b.get('/api/v1/projects/pilot/board')).json()) as {
      items: { id: string }[]
      stages: { id: string; name: string }[]
      cells: Record<string, Record<string, { id: string }>>
    }
    const stage = board.stages.find((s) => s.name === 'Implement')!
    const cellId = board.cells[board.items[0]!.id]![stage.id]!.id
    const base = '/api/v1/projects/pilot'
    await b.put(`${base}/cells/${cellId}/progress-mode`, { mode: 'tasks' })

    const made = await b.post(`${base}/employees`, {
      displayName: 'Mali',
      role: 'dev',
      provider: 'claude_code',
    })
    expect(made.status).toBe(201)
    const mali = (await made.json()) as EmployeeDto
    expect(mali).toMatchObject({ displayName: 'Mali', role: 'dev', model: null, version: 1 })
    expect((await b.post(`${base}/employees`, { displayName: 'X', role: 'boss' })).status).toBe(422)

    const task = (await (
      await b.post(`${base}/tasks`, { cellId, title: 'Email login', employeeId: mali.id })
    ).json()) as TaskDetailDto
    expect(task.employee).toMatchObject({ id: mali.id, displayName: 'Mali', role: 'dev' })

    const notReady = await b.post(`${base}/tasks/${task.id}/actions`, {
      action: 'mark_ready',
      expectedVersion: 1,
    })
    expect(notReady.status).toBe(422)
    expect(await notReady.json()).toMatchObject({
      error: { details: { code: 'not_ready', reasons: [expect.stringContaining('Pin')] } },
    })

    const pinned = await b.post(`${base}/tasks/${task.id}/context`, {
      decisions: ['Email and password only'],
      sources: [{ title: 'Mail', content: 'Offline mode is out of scope' }],
    })
    expect(pinned.status).toBe(201)
    const ctx = (await (await b.get(`${base}/tasks/${task.id}/context`)).json()) as TaskContextDto
    expect(ctx).toMatchObject({ revisionNo: 1, outdated: [] })
    expect(ctx.manifest.sources[0]).toMatchObject({ url: null, title: 'Mail' })

    const ready = await b.post(`${base}/tasks/${task.id}/actions`, {
      action: 'mark_ready',
      expectedVersion: 1,
    })
    expect(ready.status).toBe(200)
    expect(
      (await b.get(`${base}/tasks/${task.id}/context?revisionId=nope`)).status,
    ).toBeGreaterThanOrEqual(400)
  })
})
