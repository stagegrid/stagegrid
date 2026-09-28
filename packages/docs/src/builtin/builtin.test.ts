import { describe, expect, it } from 'vitest'

import { BUILTIN_TEMPLATES } from './index'

describe('built-in templates', () => {
  it('ships seven valid templates with hints everywhere', () => {
    expect(BUILTIN_TEMPLATES.map((t) => [t.key, t.level, t.schema.kind])).toEqual([
      ['brd', 'project', 'narrative'],
      ['srs', 'project', 'narrative'],
      ['mom', 'project', 'form'],
      ['release-notes', 'release', 'narrative'],
      ['change-request', 'project', 'form'],
      ['uat-signoff', 'release', 'form'],
      ['test-summary', 'release', 'narrative'],
    ])
    for (const t of BUILTIN_TEMPLATES) {
      for (const s of t.schema.sections ?? []) expect(s.hint, `${t.key}/${s.id}`).not.toBe('')
      if (t.schema.kind === 'form')
        for (const f of t.schema.fields) expect(f.hint, `${t.key}/${f.id}`).not.toBe('')
    }
  })
})
