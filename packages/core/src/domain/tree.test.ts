import { describe, expect, it } from 'vitest'

import { descendantIds, lastChildPosition, orderDepthFirst, wouldCreateCycle } from './tree'

const nodes = [
  { id: 'b', parentId: null, position: 'a1' },
  { id: 'a', parentId: null, position: 'a0' },
  { id: 'a2', parentId: 'a', position: 'a1' },
  { id: 'a1', parentId: 'a', position: 'a0' },
  { id: 'a1x', parentId: 'a1', position: 'a0' },
]

describe('tree', () => {
  it('orders depth-first by position', () => {
    expect(orderDepthFirst(nodes).map((n) => `${n.id}:${n.depth}`)).toEqual([
      'a:0',
      'a1:1',
      'a1x:2',
      'a2:1',
      'b:0',
    ])
  })
  it('finds descendants', () => {
    expect(descendantIds(nodes, 'a').sort()).toEqual(['a1', 'a1x', 'a2'])
    expect(descendantIds(nodes, 'b')).toEqual([])
  })
  it('detects cycles', () => {
    expect(wouldCreateCycle(nodes, 'a', 'a1x')).toBe(true)
    expect(wouldCreateCycle(nodes, 'a', 'a')).toBe(true)
    expect(wouldCreateCycle(nodes, 'a1x', 'b')).toBe(false)
    expect(wouldCreateCycle(nodes, 'a', null)).toBe(false)
  })
  it('finds the last child position', () => {
    expect(lastChildPosition(nodes, 'a')).toBe('a1')
    expect(lastChildPosition(nodes, 'b')).toBeNull()
  })
})
