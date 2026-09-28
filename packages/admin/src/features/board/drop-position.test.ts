import { describe, expect, it } from 'vitest'

import { dropPosition, moveRequest } from './drop-position'

describe('dropPosition', () => {
  it('splits a row into before / inside / after', () => {
    expect(dropPosition(2, 32)).toBe('before')
    expect(dropPosition(16, 32)).toBe('inside')
    expect(dropPosition(30, 32)).toBe('after')
  })
  it('builds move requests', () => {
    expect(moveRequest('x', 'inside')).toEqual({ parent: 'x' })
    expect(moveRequest('x', 'before')).toEqual({ before: 'x' })
  })
})
