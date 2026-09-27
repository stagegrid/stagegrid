import type { CellDetailDto, CommentDto, LinkDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'

const getDb = useTestDatabase()

describe('cell detail endpoints', () => {
  it('comments, links, history edits, and export include them', async () => {
    const { app } = makeApp(getDb())
    const b = browser(app)
    await b.post('/api/v1/setup', SETUP_BODY)
    await b.post('/api/v1/projects', { name: 'Pilot' })
    await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Login' }] })
    const res = await b.post('/api/v1/projects/pilot/changes', {
      changes: [
        {
          item: 'Login',
          stage: 'QA',
          status: 'done',
          happenedAt: '2026-10-01T00:00:00Z',
          assignees: [{ name: 'Somchai' }],
        },
      ],
    })
    const cellId = ((await res.json()) as { results: { cellId: string }[] }).results[0]!.cellId
    const base = '/api/v1/projects/pilot'

    const comment = (await (
      await b.post(`${base}/cells/${cellId}/comments`, { body: 'Looks good' })
    ).json()) as CommentDto
    expect((await b.patch(`${base}/comments/${comment.id}`, { body: 'Looks great' })).status).toBe(
      204,
    )
    const link = (await (
      await b.post(`${base}/cells/${cellId}/links`, {
        title: 'Test plan',
        url: 'https://docs.example.com/tp',
        kind: 'doc',
      })
    ).json()) as LinkDto
    expect(link.kind).toBe('doc')
    expect(
      (await b.post(`${base}/cells/${cellId}/links`, { title: 'bad', url: 'ftp://x' })).status,
    ).toBe(422)

    let detail = (await (await b.get(`${base}/cells/${cellId}`)).json()) as CellDetailDto
    expect(detail.comments.map((c) => c.body)).toEqual(['Looks great'])
    expect(detail.assignees).toEqual([{ userId: null, name: 'Somchai' }])
    const eventId = detail.events[0]!.id
    expect(
      (await b.patch(`${base}/events/${eventId}`, { happenedAt: '2026-10-02T00:00:00Z' })).status,
    ).toBe(200)
    detail = (await (await b.get(`${base}/cells/${cellId}`)).json()) as CellDetailDto
    expect(detail.events[0]!.happenedAt).toBe('2026-10-02T00:00:00.000Z')

    const exported = (await (await b.get(`${base}/export`)).json()) as {
      cells: {
        itemPath: string
        stage: string
        assignees: string[]
        comments: unknown[]
        links: unknown[]
      }[]
    }
    const qa = exported.cells.find((c) => c.itemPath === 'Login' && c.stage === 'QA')!
    expect(qa).toMatchObject({
      assignees: ['Somchai'],
      comments: [expect.objectContaining({ body: 'Looks great' })],
      links: [expect.objectContaining({ title: 'Test plan' })],
    })

    expect((await b.delete(`${base}/links/${link.id}`)).status).toBe(204)
    expect((await b.delete(`${base}/comments/${comment.id}`)).status).toBe(204)
    expect(await (await b.delete(`${base}/events/${eventId}`)).json()).toMatchObject({
      status: 'todo',
    })
  })
})
