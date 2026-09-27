export type DropPosition = 'before' | 'inside' | 'after'

/** Top quarter = before, bottom quarter = after, middle = inside (become a child). */
export function dropPosition(offsetY: number, height: number): DropPosition {
  if (offsetY < height * 0.25) return 'before'
  if (offsetY > height * 0.75) return 'after'
  return 'inside'
}

export function moveRequest(
  targetId: string,
  pos: DropPosition,
): { parent?: string; before?: string; after?: string } {
  if (pos === 'inside') return { parent: targetId }
  return pos === 'before' ? { before: targetId } : { after: targetId }
}
