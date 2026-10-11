import { conflict } from '../errors'

/** Shown when a direct status write hits a cell whose progress comes from its tasks. */
export const TASK_MANAGED_MESSAGE =
  "This cell's status comes from its tasks. Update the tasks, or switch the cell back to manual progress."

export function assertCellWritable(cell: { id: string; progressMode: string }): void {
  if (cell.progressMode === 'tasks')
    throw conflict(TASK_MANAGED_MESSAGE, { code: 'task_managed_cell', cellId: cell.id })
}
