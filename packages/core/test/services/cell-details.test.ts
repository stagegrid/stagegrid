import { describe, expect, it } from 'vitest'

import { getBoard, getCellByRefs } from '../../src/services/board.service'
import {
  addComment,
  addLink,
  deleteLink,
  updateComment,
} from '../../src/services/cell-details.service'
import { applyChanges } from '../../src/services/changes.service'
import { editEvent } from '../../src/services/events.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, asVia, createUser, makeCtx, seedProject } from '../helpers/factories'
import { captureEvents } from '../helpers/listen'

const getDb = useTestDatabase()

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true, name: 'Pond' })
  const bee = await createUser(db, { name: 'Bee' })
  const project = await seedProject(db, admin, { tree: [{ name: 'Login' }, { name: 'Reports' }] })
  await addMember(db, project.id, bee.userId, 'editor')
  return { db, admin, bee, project, ctx: makeCtx(db, admin) }
}

describe('cell details through applyChanges', () => {
  it('sets assignees (members or free-text names), planned dates, a comment, and a link', async () => {
    const { ctx, bee, project } = await setup()
    const res = await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [
        {
          item: 'Login',
          stage: 'QA',
          assignees: [
            { userId: bee.userId },
            { name: 'Somchai (Jira)' },
            { name: 'somchai (jira)' },
          ],
          plannedStart: '2026-10-01',
          plannedEnd: '2026-10-10',
          comment: 'Blocked on **API** spec',
          link: {
            title: 'PROJ-123',
            url: 'https://jira.example.com/browse/PROJ-123',
            kind: 'issue',
          },
        },
      ],
    })
    expect(res.results[0]).toMatchObject({
      outcome: 'changed',
      details: ['assignees', 'planned', 'comment', 'link'],
      after: { status: 'todo' },
    })
    const cell = await getCellByRefs(ctx, project.id, 'Login', 'QA')
    expect(cell.assignees).toEqual([
      { userId: bee.userId, name: 'Bee' },
      { userId: null, name: 'Somchai (Jira)' },
    ])
    expect(cell).toMatchObject({ plannedStart: '2026-10-01', plannedEnd: '2026-10-10' })
    expect(cell.comments).toEqual([
      expect.objectContaining({
        body: 'Blocked on **API** spec',
        author: { userId: expect.any(String), name: 'Pond', via: 'web' },
      }),
    ])
    expect(cell.links).toEqual([expect.objectContaining({ title: 'PROJ-123', kind: 'issue' })])
    const board = await getBoard(ctx, project.id)
    const login = board.items.find((i) => i.name === 'Login')!
    expect(login.assignees.map((a) => a.name)).toEqual(['Bee', 'Somchai (Jira)'])
    const qa = board.stages.find((s) => s.name === 'QA')!
    expect(board.cells[login.id]![qa.id]).toMatchObject({ hasComments: true, hasDocLink: false })
  })

  it('validates membership and planned date order against current values', async () => {
    const { db, ctx, project } = await setup()
    const outsider = await createUser(db)
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'QA', plannedEnd: '2026-10-10' }],
    })
    await expect(
      applyChanges(ctx, project.id, {
        dryRun: false,
        changes: [
          { item: 'Login', stage: 'QA', plannedStart: '2026-10-11' },
          { item: 'Reports', stage: 'QA', assignees: [{ userId: outsider.userId }] },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      details: {
        errors: [
          expect.objectContaining({
            index: 0,
            message: 'plannedStart 2026-10-11 is after plannedEnd 2026-10-10',
          }),
          expect.objectContaining({ index: 1, message: expect.stringContaining('not a member') }),
        ],
      },
    })
  })

  it('past planned end makes a cell stale', async () => {
    const { ctx, project } = await setup()
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [{ item: 'Login', stage: 'QA', plannedEnd: '2026-10-19' }],
    })
    const board = await getBoard(ctx, project.id)
    expect(board.stats.stale).toBe(1)
  })

  it('sends cell.detail_updated for detail-only changes', async () => {
    const { db, admin, project } = await setup()
    const events = await captureEvents(() =>
      applyChanges(makeCtx(db, asVia(admin, 'mcp')), project.id, {
        dryRun: false,
        changes: [{ item: 'Login', stage: 'QA', comment: 'hi' }],
      }),
    )
    expect(events.map((e) => e.type)).toEqual(['cell.detail_updated'])
  })
})

describe('comments and links', () => {
  it('lets authors edit their comments and owners delete anyone’s', async () => {
    const { db, ctx, bee, project } = await setup()
    const cell = await getCellByRefs(ctx, project.id, 'Login', 'QA')
    const beeCtx = makeCtx(db, bee)
    const c = await addComment(beeCtx, project.id, cell.id, 'first')
    await updateComment(beeCtx, project.id, c.id, 'first (edited)')
    const mine = await addComment(ctx, project.id, cell.id, 'owner note')
    await expect(updateComment(beeCtx, project.id, mine.id, 'hijack')).rejects.toMatchObject({
      code: 'forbidden',
    })
    await updateComment(ctx, project.id, c.id, null)
    const after = await getCellByRefs(ctx, project.id, 'Login', 'QA')
    expect(after.comments.map((x) => x.body)).toEqual(['owner note'])
  })

  it('adds and removes links', async () => {
    const { ctx, project } = await setup()
    const cell = await getCellByRefs(ctx, project.id, 'Login', 'Document')
    const link = await addLink(ctx, project.id, cell.id, {
      title: 'SRS',
      url: 'https://docs.example.com/srs',
      kind: 'doc',
    })
    let board = await getBoard(ctx, project.id)
    const login = board.items.find((i) => i.name === 'Login')!
    expect(Object.values(board.cells[login.id]!).some((x) => x.hasDocLink)).toBe(true)
    await deleteLink(ctx, project.id, link.id)
    board = await getBoard(ctx, project.id)
    expect(Object.values(board.cells[login.id]!).some((x) => x.hasDocLink)).toBe(false)
  })
})

describe('editEvent', () => {
  it('moves or deletes an event and recomputes status and rounds', async () => {
    const { ctx, project } = await setup()
    await applyChanges(ctx, project.id, {
      dryRun: false,
      changes: [
        { item: 'Login', stage: 'QA', status: 'doing', happenedAt: '2026-10-01T00:00:00Z' },
        { item: 'Login', stage: 'QA', status: 'done', happenedAt: '2026-10-05T00:00:00Z' },
      ],
    })
    let cell = await getCellByRefs(ctx, project.id, 'Login', 'QA')
    const doneEvent = cell.events.find((e) => e.toStatus === 'done')!
    await editEvent(ctx, project.id, doneEvent.id, { happenedAt: '2026-10-08T00:00:00Z' })
    cell = await getCellByRefs(ctx, project.id, 'Login', 'QA')
    expect(cell.rounds[0]).toMatchObject({ endedAt: '2026-10-08T00:00:00.000Z' })
    await editEvent(ctx, project.id, doneEvent.id, { delete: true })
    cell = await getCellByRefs(ctx, project.id, 'Login', 'QA')
    expect(cell.status).toBe('doing')
    expect(cell.events).toHaveLength(1)
    await expect(editEvent(ctx, project.id, doneEvent.id, { delete: true })).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})
