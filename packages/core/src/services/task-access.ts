import { and, eq } from 'drizzle-orm'

import type { DbOrTx, Tx } from '../db/client'
import { tasks } from '../db/schema'
import { notFound } from '../errors'
import type { ProjectRow } from './access'

export type TaskRow = typeof tasks.$inferSelect

export async function loadTaskInProject(
  db: DbOrTx,
  project: ProjectRow,
  taskId: string,
): Promise<TaskRow> {
  const [t] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, project.id)))
  if (!t) throw notFound('Task not found')
  return t
}

/** Locks the task row. Take it before any run row so concurrent claims, cancels and answers can't deadlock. */
export async function lockTask(tx: Tx, taskId: string): Promise<TaskRow> {
  const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for('update')
  if (!t) throw notFound('Task not found')
  return t
}
