import { describe, expect, it } from 'vitest'

import { slugify, uniqueSlug } from './slug'

describe('slugify', () => {
  it('kebab-cases Latin names and strips accents', () => {
    expect(slugify('Clinic OS — Phase 2')).toBe('clinic-os-phase-2')
    expect(slugify('Café Déjà vu')).toBe('cafe-deja-vu')
  })
  it('falls back for names without Latin characters', () => {
    expect(slugify('ระบบคลินิก', () => 0)).toBe('project-aaaaaa')
  })
  it('caps length at 50 without a trailing hyphen', () => {
    const s = slugify(`${'a'.repeat(49)} b`)
    expect(s.length).toBeLessThanOrEqual(50)
    expect(s.endsWith('-')).toBe(false)
  })
})

describe('uniqueSlug', () => {
  it('appends a counter', () => {
    expect(uniqueSlug('clinic', new Set())).toBe('clinic')
    expect(uniqueSlug('clinic', new Set(['clinic', 'clinic-2']))).toBe('clinic-3')
  })
})
