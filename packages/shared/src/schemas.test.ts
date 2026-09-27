import { describe, expect, it } from 'vitest'

import {
  changesInput,
  createItemsInput,
  emailSchema,
  itemNameSchema,
  setupInput,
  slugSchema,
} from './schemas'

describe('schemas', () => {
  it('normalizes email', () => {
    expect(emailSchema.parse('  Pond@Example.COM ')).toBe('pond@example.com')
    expect(emailSchema.safeParse('nope').success).toBe(false)
  })
  it('rejects item names containing the path separator', () => {
    expect(itemNameSchema.safeParse('A > B').success).toBe(false)
    expect(itemNameSchema.parse(' A>B ')).toBe('A>B')
  })
  it('validates slugs', () => {
    expect(slugSchema.safeParse('clinic-os').success).toBe(true)
    expect(slugSchema.safeParse('Clinic OS').success).toBe(false)
  })
  it('parses nested item trees', () => {
    const r = createItemsInput.parse({
      items: [{ name: 'Settings', children: [{ name: 'Users' }] }],
    })
    expect(r.items[0]?.children?.[0]?.name).toBe('Users')
    expect(
      createItemsInput.safeParse({ items: [{ name: 'A', children: [{ name: '' }] }] }).success,
    ).toBe(false)
  })
  it('defaults dryRun and requires an offset on happenedAt', () => {
    expect(
      changesInput.parse({ changes: [{ item: 'a', stage: 'b', status: 'done' }] }).dryRun,
    ).toBe(false)
    expect(
      changesInput.safeParse({
        changes: [{ item: 'a', stage: 'b', happenedAt: '2026-10-01T10:00:00' }],
      }).success,
    ).toBe(false)
    expect(
      changesInput.safeParse({
        changes: [{ item: 'a', stage: 'b', happenedAt: '2026-10-01T10:00:00+07:00' }],
      }).success,
    ).toBe(true)
  })
  it('rejects unknown time zones on setup', () => {
    const base = { name: 'P', email: 'p@x.io', password: '0123456789' }
    expect(setupInput.safeParse({ ...base, timezone: 'Asia/Bangkok' }).success).toBe(true)
    expect(setupInput.safeParse({ ...base, timezone: 'Nowhere/City' }).success).toBe(false)
  })
})
