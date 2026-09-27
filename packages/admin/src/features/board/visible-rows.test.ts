import type { BoardDto, CellStatus } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { visibleRows } from './visible-rows'

function board(
  rows: [
    id: string,
    parent: string | null,
    depth: number,
    statuses: CellStatus[],
    stale?: boolean,
    who?: string,
  ][],
): BoardDto {
  return {
    project: { id: 'p', slug: 'p', name: 'P', timezone: 'UTC', staleDays: 7, role: 'owner' },
    stages: [
      { id: 's1', name: 'A', position: 'a0', archivedAt: null },
      { id: 's2', name: 'B', position: 'a1', archivedAt: null },
    ],
    items: rows.map(([id, parentId, depth, , , who]) => ({
      id,
      parentId,
      name: id,
      position: 'a0',
      depth,
      assignees: who ? [{ userId: null, name: who }] : [],
      releases: [],
    })),
    cells: Object.fromEntries(
      rows.map(([id, , , st, stale]) => [
        id,
        Object.fromEntries(
          st.map((status, n) => [
            `s${n + 1}`,
            {
              id: `${id}${n}`,
              status,
              rework: 0,
              stale: stale && n === 0 ? 'doing_too_long' : null,
              hasComments: false,
              hasDocLink: false,
            },
          ]),
        ),
      ]),
    ),
    stats: {
      items: 0,
      all: 0,
      open: 0,
      doing: 0,
      done: 0,
      percent: 0,
      rework: 0,
      stale: 0,
      byStage: {},
    },
  }
}

const b = board([
  ['login', null, 0, ['done', 'done']],
  ['settings', null, 0, ['done', 'skip']],
  ['users', 'settings', 1, ['done', 'todo']],
  ['roles', 'users', 2, ['done', 'done']],
  ['reports', null, 0, ['doing', 'todo'], true, 'Somchai'],
])
const ids = (rows: ReturnType<typeof visibleRows>) =>
  rows.map((r) => (r.context ? `(${r.item.id})` : r.item.id))
const none = { allToDo: false, needsUpdate: false }

describe('visibleRows', () => {
  it('shows everything by default and marks parents', () => {
    const rows = visibleRows(b, new Set(), none)
    expect(ids(rows)).toEqual(['login', 'settings', 'users', 'roles', 'reports'])
    expect(rows.find((r) => r.item.id === 'settings')!.hasChildren).toBe(true)
  })
  it('collapses subtrees', () => {
    expect(ids(visibleRows(b, new Set(['settings']), none))).toEqual([
      'login',
      'settings',
      'reports',
    ])
  })
  it('All to do keeps unfinished rows and their ancestors as context', () => {
    expect(ids(visibleRows(b, new Set(), { allToDo: true, needsUpdate: false }))).toEqual([
      '(settings)',
      'users',
      'reports',
    ])
  })
  it('Needs update keeps stale rows only', () => {
    expect(ids(visibleRows(b, new Set(), { allToDo: false, needsUpdate: true }))).toEqual([
      'reports',
    ])
  })
  it('filters by assignee', () => {
    expect(ids(visibleRows(b, new Set(), { ...none, assignee: 'name:somchai' }))).toEqual([
      'reports',
    ])
  })
  it('limits to a set of items (a release scope) with ancestors as context', () => {
    expect(ids(visibleRows(b, new Set(), { ...none, items: new Set(['users']) }))).toEqual([
      '(settings)',
      'users',
    ])
  })
})
