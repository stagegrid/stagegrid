import type { CellStatus } from '@stagegrid/shared'

export const STATUS_ORDER: CellStatus[] = ['skip', 'todo', 'doing', 'done']

export const STATUS_META: Record<
  CellStatus,
  { label: string; key: string; cell: string; text: string }
> = {
  skip: { label: 'Skip', key: '1', cell: 'bg-status-skip', text: 'text-status-skip-foreground' },
  todo: { label: 'To do', key: '2', cell: 'bg-status-todo', text: 'text-status-todo-foreground' },
  doing: {
    label: 'Doing',
    key: '3',
    cell: 'bg-status-doing',
    text: 'text-status-doing-foreground',
  },
  done: { label: 'Done', key: '4', cell: 'bg-status-done', text: 'text-status-done-foreground' },
}

export function cellLabel(
  itemName: string,
  stageName: string,
  status: CellStatus,
  rework: number,
  stale: boolean,
): string {
  const parts = [`${itemName}, ${stageName}: ${STATUS_META[status].label}`]
  if (rework === 1) parts.push('reworked once')
  if (rework > 1) parts.push(`reworked ${rework} times`)
  if (stale) parts.push('needs update')
  return parts.join(', ')
}
