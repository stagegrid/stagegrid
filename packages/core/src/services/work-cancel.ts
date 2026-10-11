import { ACTIVE_RUN_STATES } from '@stagegrid/shared'
import { and, eq, inArray } from 'drizzle-orm'

import type { Tx } from '../db/client'
import { questionBatches, questions, runs } from '../db/schema'

type RunRow = typeof runs.$inferSelect

/** Cancels whatever a run had open for people to answer, so a late answer can't restart it. */
export async function cancelOpenQuestions(tx: Tx, taskId: string, now: Date): Promise<void> {
  const open = await tx
    .select({ id: questionBatches.id })
    .from(questionBatches)
    .where(and(eq(questionBatches.taskId, taskId), eq(questionBatches.state, 'open')))
  if (open.length === 0) return
  const ids = open.map((b) => b.id)
  await tx
    .update(questions)
    .set({ state: 'cancelled' })
    .where(and(inArray(questions.batchId, ids), eq(questions.state, 'open')))
  await tx
    .update(questionBatches)
    .set({ state: 'cancelled', closedAt: now })
    .where(inArray(questionBatches.id, ids))
}

/** The one place a run is cancelled: claim revoked, questions cancelled, nothing left to resume. */
export async function cancelRunRows(
  tx: Tx,
  run: RunRow,
  now: Date,
  reason: string | null,
): Promise<RunRow> {
  const [row] = await tx
    .update(runs)
    .set({
      state: 'cancelled',
      fencingToken: run.fencingToken + 1,
      leaseExpiresAt: null,
      resumeAt: null,
      failureReason: reason,
      finishedAt: now,
      updatedAt: now,
    })
    .where(eq(runs.id, run.id))
    .returning()
  await cancelOpenQuestions(tx, run.taskId, now)
  return row!
}

export const isActiveRunRow = (r: Pick<RunRow, 'state'>): boolean =>
  ACTIVE_RUN_STATES.includes(r.state)
