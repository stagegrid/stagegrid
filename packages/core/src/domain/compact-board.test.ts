import type { BoardDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { compactBoard } from './compact-board'

const board: BoardDto = {
  project: {
    id: 'p',
    slug: 'clinic-os',
    name: 'Clinic OS',
    timezone: 'UTC',
    staleDays: 7,
    role: 'owner',
  },
  stages: [
    { id: 's1', name: 'Design', position: 'a0', archivedAt: null },
    { id: 's2', name: 'QA', position: 'a1', archivedAt: null },
  ],
  items: [
    { id: 'i1', parentId: null, name: 'Login', position: 'a0', depth: 0, assignees: [] },
    { id: 'i2', parentId: null, name: 'Settings', position: 'a1', depth: 0, assignees: [] },
    { id: 'i3', parentId: 'i2', name: 'Users', position: 'a0', depth: 1, assignees: [] },
  ],
  cells: {
    i1: {
      s1: {
        id: 'c1',
        status: 'done',
        rework: 0,
        stale: null,
        hasComments: false,
        hasDocLink: false,
      },
      s2: {
        id: 'c2',
        status: 'doing',
        rework: 1,
        stale: 'doing_too_long',
        hasComments: false,
        hasDocLink: false,
      },
    },
    i2: {
      s1: {
        id: 'c3',
        status: 'skip',
        rework: 0,
        stale: null,
        hasComments: false,
        hasDocLink: false,
      },
      s2: {
        id: 'c4',
        status: 'todo',
        rework: 0,
        stale: null,
        hasComments: false,
        hasDocLink: false,
      },
    },
    i3: {
      s1: {
        id: 'c5',
        status: 'todo',
        rework: 0,
        stale: null,
        hasComments: false,
        hasDocLink: false,
      },
      s2: {
        id: 'c6',
        status: 'todo',
        rework: 0,
        stale: null,
        hasComments: false,
        hasDocLink: false,
      },
    },
  },
  stats: {
    items: 3,
    all: 5,
    open: 4,
    doing: 1,
    done: 1,
    percent: 20,
    rework: 1,
    stale: 1,
    byStage: {},
  },
}

describe('compactBoard', () => {
  it('renders one line per item with status codes and suffixes', () => {
    const c = compactBoard(board)
    expect(c.stages).toEqual(['Design', 'QA'])
    expect(c.rows).toEqual(['Login | D P^1*', 'Settings | - T', 'Settings > Users | T T'])
    expect(c.stats).toEqual({
      items: 3,
      all: 5,
      open: 4,
      doing: 1,
      done: 1,
      percent: 20,
      rework: 1,
      stale: 1,
    })
  })
  it('limits to a branch', () => {
    expect(compactBoard(board, 'i2').rows).toEqual(['Settings | - T', 'Settings > Users | T T'])
  })
})
