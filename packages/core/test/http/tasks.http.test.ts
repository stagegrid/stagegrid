import type { BoardDto, TaskDetailDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()

describe('tasks API', () => {
  it('manages a cell through its tasks and refuses direct status writes', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    await b.post('/api/v1/projects', { name: 'Pilot' })
    await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Login' }] })
    const board = (await (await b.get('/api/v1/projects/pilot/board')).json()) as BoardDto
    const item = board.items[0]!
    const stage = board.stages.find((s) => s.name === 'Implement')!
    const cellId = board.cells[item.id]![stage.id]!.id
    const base = '/api/v1/projects/pilot'

    expect((await b.post(`${base}/tasks`, { cellId, title: 'API' })).status).toBe(409)
    const mode = await b.put(`${base}/cells/${cellId}/progress-mode`, { mode: 'tasks' })
    expect(mode.status).toBe(200)

    const created = await b.post(`${base}/tasks`, { cellId, title: 'API' })
    expect(created.status).toBe(201)
    const task = (await created.json()) as TaskDetailDto
    expect(task).toMatchObject({ state: 'draft', actions: ['mark_ready', 'cancel'], version: 1 })

    const stale = await b.post(`${base}/tasks/${task.id}/actions`, {
      action: 'mark_ready',
      expectedVersion: 7,
    })
    expect(stale.status).toBe(409)
    const ok = await b.post(`${base}/tasks/${task.id}/actions`, {
      action: 'mark_ready',
      expectedVersion: 1,
    })
    expect(((await ok.json()) as TaskDetailDto).state).toBe('ready')

    const direct = await b.post(`${base}/changes`, {
      changes: [{ item: 'Login', stage: 'Implement', status: 'done' }],
    })
    expect(direct.status).toBe(409)
    expect(await direct.json()).toMatchObject({
      error: { code: 'conflict', message: expect.stringContaining('comes from its tasks') },
    })

    const list = (await (await b.get(`${base}/tasks?state=ready`)).json()) as TaskDetailDto[]
    expect(list.map((t) => t.title)).toEqual(['API'])
    expect(
      (await b.post(`${base}/tasks/${task.id}/actions`, { action: 'nope', expectedVersion: 2 }))
        .status,
    ).toBe(422)
  })
})
