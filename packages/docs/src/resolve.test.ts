import { describe, expect, it } from 'vitest'

import { resolveTemplate } from './resolve'
import { templateSchema } from './schema'
import { validateDraft } from './validate'

const items = [
  { id: 'a', parentId: null, name: 'Login', path: 'Login' },
  { id: 'b', parentId: null, name: 'Settings', path: 'Settings' },
  { id: 'c', parentId: 'b', name: 'Users', path: 'Settings > Users' },
  { id: 'd', parentId: 'c', name: 'Roles', path: 'Settings > Users > Roles' },
]

describe('resolveTemplate', () => {
  it('numbers repeated sections per item up to the depth', () => {
    const schema = templateSchema.parse({
      kind: 'narrative',
      sections: [
        { id: '3', title: 'Functional requirements', level: 1, hint: 'Lead-in' },
        {
          id: '3.1',
          title: 'Feature',
          level: 2,
          hint: 'Describe it.',
          repeat: { source: 'items', depth: 2 },
        },
        { id: '4', title: 'Non-functional', level: 1 },
      ],
    })
    const r = resolveTemplate(schema, { items })
    expect(r.sections.map((s) => [s.id, s.number, s.title])).toEqual([
      ['3', '3', 'Functional requirements'],
      ['3.1/a', '3.1', 'Login'],
      ['3.1/b', '3.2', 'Settings'],
      ['3.1/c', '3.3', 'Users'],
      ['4', '4', 'Non-functional'],
    ])
    expect(r.sections[3]!.hint).toBe('Describe it. Item: Settings > Users')
  })

  it('repeats release items filtered by kind, and item docs start under their item', () => {
    const schema = templateSchema.parse({
      kind: 'narrative',
      sections: [
        { id: '2.1', title: 'New', level: 2, repeat: { source: 'release_items', kind: 'new' } },
      ],
    })
    const r = resolveTemplate(schema, {
      items,
      releaseItems: [
        { id: 'a', path: 'Login', name: 'Login', kind: 'change', stages: ['QA'], note: null },
        {
          id: 'c',
          path: 'Settings > Users',
          name: 'Users',
          kind: 'new',
          stages: ['Design', 'QA'],
          note: 'v2',
        },
      ],
    })
    expect(r.sections).toEqual([
      {
        id: '2.1/c',
        number: '2.1',
        title: 'Users',
        level: 2,
        hint: 'Item: Settings > Users (new), stages: Design, QA, note: v2',
      },
    ])
    const itemDoc = resolveTemplate(
      templateSchema.parse({
        kind: 'narrative',
        sections: [{ id: 'x', title: 'Sub', level: 2, repeat: { source: 'items', depth: 1 } }],
      }),
      {
        items,
        rootItemId: 'b',
      },
    )
    expect(itemDoc.sections.map((s) => s.title)).toEqual(['Users'])
  })
})

describe('templateSchema / validateDraft', () => {
  it('rejects duplicate ids and table fields without columns', () => {
    expect(
      templateSchema.safeParse({
        kind: 'narrative',
        sections: [
          { id: '1', title: 'A', level: 1 },
          { id: '1', title: 'B', level: 1 },
        ],
      }).success,
    ).toBe(false)
    expect(
      templateSchema.safeParse({ kind: 'form', fields: [{ id: 't', label: 'T', type: 'table' }] })
        .success,
    ).toBe(false)
  })
  it('checks section ids and field types', () => {
    const t = resolveTemplate(
      templateSchema.parse({
        kind: 'form',
        fields: [
          { id: 'date', label: 'Date', type: 'date' },
          { id: 'who', label: 'Attendees', type: 'list' },
          {
            id: 'actions',
            label: 'Actions',
            type: 'table',
            columns: [{ id: 'task', label: 'Task' }],
          },
        ],
      }),
      { items: [] },
    )
    expect(
      validateDraft(t, { fields: { date: '2026-10-01', who: ['A'], actions: [{ task: 'x' }] } }),
    ).toEqual([])
    expect(
      validateDraft(t, {
        sections: { nope: 'x' },
        fields: { date: '1 Oct', who: 'A', actions: [{ owner: 'x' }], other: 'y' },
      }),
    ).toEqual([
      'Unknown section "nope"',
      'Field "date" must be YYYY-MM-DD',
      'Field "who" must be a list of strings',
      'Field "actions" has unknown column "owner"',
      'Unknown field "other"',
    ])
  })
})
