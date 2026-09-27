import { describe, expect, it } from 'vitest'

import { buildPathIndex, resolveByName } from './refs'

const items = [
  { id: 'settings', parentId: null, name: 'Settings' },
  { id: 'users1', parentId: 'settings', name: 'Users' },
  { id: 'admin', parentId: null, name: 'Admin' },
  { id: 'users2', parentId: 'admin', name: 'Users' },
  { id: 'master', parentId: 'settings', name: 'Master data' },
  { id: 'veh', parentId: 'master', name: 'Vehicles' },
  { id: 'gt', parentId: null, name: 'A>B' },
]

describe('buildPathIndex', () => {
  const idx = buildPathIndex(items)
  it('builds display paths', () => {
    expect(idx.pathOf('veh')).toBe('Settings > Master data > Vehicles')
  })
  it('resolves by id and by path, ignoring case and extra spaces', () => {
    expect(idx.resolve('veh')).toEqual({ ok: true, id: 'veh' })
    expect(idx.resolve('settings >  master DATA > vehicles ')).toEqual({ ok: true, id: 'veh' })
    expect(idx.resolve('A>B')).toEqual({ ok: true, id: 'gt' })
  })
  it('does not match a child name alone', () => {
    const r = idx.resolve('Vehicles')
    expect(r).toEqual({
      ok: false,
      code: 'not_found',
      suggestions: ['Settings > Master data > Vehicles'],
    })
  })
  it('reports ambiguity with candidates', () => {
    const dup = buildPathIndex([...items, { id: 'users3', parentId: 'settings', name: 'users' }])
    const r = dup.resolve('Settings > Users')
    expect(r.ok).toBe(false)
    if (!r.ok && r.code === 'ambiguous_ref') {
      expect(r.candidates.map((c) => c.id).sort()).toEqual(['users1', 'users3'])
    } else throw new Error('expected ambiguous_ref')
  })
})

describe('resolveByName', () => {
  const stages = [
    { id: 's1', name: 'Design' },
    { id: 's2', name: 'Back-End' },
  ]
  it('matches id or name case-insensitively', () => {
    expect(resolveByName(stages, 's2')).toEqual({ ok: true, id: 's2' })
    expect(resolveByName(stages, ' back-end ')).toEqual({ ok: true, id: 's2' })
  })
  it('suggests near names', () => {
    expect(resolveByName(stages, 'back')).toEqual({
      ok: false,
      code: 'not_found',
      suggestions: ['Back-End'],
    })
  })
})
