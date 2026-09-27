import { LIMITS, type StageDto } from '@stagegrid/shared'
import { and, eq } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'

import type { DbOrTx } from '../db/client'
import { stages } from '../db/schema'
import { conflict, invalid, notFound } from '../errors'
import { newId } from '../lib/ids'
import { notify } from '../realtime/notify'
import { requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'
import { ensureCells, loadItems, loadStages, type StageRow } from './structure'

export function toStageDto(s: StageRow): StageDto {
  return {
    id: s.id,
    name: s.name,
    position: s.position,
    archivedAt: s.archivedAt?.toISOString() ?? null,
  }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Position between the neighbours implied by beforeId/afterId (append when neither is given). */
function positionFor(
  active: StageRow[],
  opts: { beforeId?: string; afterId?: string },
  movingId?: string,
): string {
  const list = active.filter((s) => s.id !== movingId)
  if (opts.afterId) {
    const i = list.findIndex((s) => s.id === opts.afterId)
    if (i < 0) throw notFound('Stage to place after was not found')
    return generateKeyBetween(list[i]!.position, list[i + 1]?.position ?? null)
  }
  if (opts.beforeId) {
    const i = list.findIndex((s) => s.id === opts.beforeId)
    if (i < 0) throw notFound('Stage to place before was not found')
    return generateKeyBetween(list[i - 1]?.position ?? null, list[i]!.position)
  }
  return generateKeyBetween(list.at(-1)?.position ?? null, null)
}

async function getStage(db: DbOrTx, projectId: string, stageId: string): Promise<StageRow> {
  const [s] = await db
    .select()
    .from(stages)
    .where(and(eq(stages.id, stageId), eq(stages.projectId, projectId)))
  if (!s) throw notFound('Stage not found')
  return s
}

export async function listStages(ctx: ServiceContext, ref: string): Promise<StageDto[]> {
  const { project } = await requireProjectRole(ctx, ref, 'viewer')
  return (await loadStages(ctx.db, project.id, { includeArchived: true })).map(toStageDto)
}

export async function createStage(
  ctx: ServiceContext,
  ref: string,
  input: { name: string; afterId?: string },
): Promise<StageDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  return withTx(ctx, async (tx, txCtx) => {
    const active = await loadStages(tx, project.id)
    if (active.length >= LIMITS.activeStagesPerProject)
      throw conflict(`A project can have at most ${LIMITS.activeStagesPerProject} stages`)
    if (active.some((s) => sameName(s.name, input.name)))
      throw conflict('A stage with this name already exists')
    const now = ctx.now()
    const [stage] = await tx
      .insert(stages)
      .values({
        id: newId(),
        projectId: project.id,
        name: input.name,
        position: positionFor(active, input),
        createdAt: now,
      })
      .returning()
    const items = await loadItems(tx, project.id)
    await ensureCells(
      tx,
      items.map((i) => ({ itemId: i.id, stageId: stage!.id })),
      now,
      newId,
    )
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'stage.create',
      targetType: 'stage',
      targetId: stage!.id,
      after: { name: input.name },
    })
    await notify(tx, txCtx, project.id, 'stage.changed')
    return toStageDto(stage!)
  })
}

export async function renameStage(
  ctx: ServiceContext,
  ref: string,
  stageId: string,
  name: string,
): Promise<StageDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  return withTx(ctx, async (tx, txCtx) => {
    const stage = await getStage(tx, project.id, stageId)
    const active = await loadStages(tx, project.id)
    if (active.some((s) => s.id !== stageId && sameName(s.name, name)))
      throw conflict('A stage with this name already exists')
    const [updated] = await tx
      .update(stages)
      .set({ name })
      .where(eq(stages.id, stageId))
      .returning()
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'stage.update',
      targetType: 'stage',
      targetId: stageId,
      before: { name: stage.name },
      after: { name },
    })
    await notify(tx, txCtx, project.id, 'stage.changed')
    return toStageDto(updated!)
  })
}

export async function moveStage(
  ctx: ServiceContext,
  ref: string,
  stageId: string,
  input: { beforeId?: string; afterId?: string },
): Promise<StageDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  if (!input.beforeId && !input.afterId) throw invalid('Give beforeId or afterId')
  return withTx(ctx, async (tx, txCtx) => {
    const stage = await getStage(tx, project.id, stageId)
    if (stage.archivedAt) throw conflict('Restore the stage before moving it')
    const active = await loadStages(tx, project.id)
    const position = positionFor(active, input, stageId)
    const [updated] = await tx
      .update(stages)
      .set({ position })
      .where(eq(stages.id, stageId))
      .returning()
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'stage.move',
      targetType: 'stage',
      targetId: stageId,
      before: { position: stage.position },
      after: { position },
    })
    await notify(tx, txCtx, project.id, 'stage.changed')
    return toStageDto(updated!)
  })
}

export async function setStageArchived(
  ctx: ServiceContext,
  ref: string,
  stageId: string,
  archived: boolean,
): Promise<StageDto> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  return withTx(ctx, async (tx, txCtx) => {
    const stage = await getStage(tx, project.id, stageId)
    if (archived === (stage.archivedAt !== null)) return toStageDto(stage)
    const now = ctx.now()
    if (!archived) {
      const active = await loadStages(tx, project.id)
      if (active.length >= LIMITS.activeStagesPerProject)
        throw conflict(`A project can have at most ${LIMITS.activeStagesPerProject} stages`)
      if (active.some((s) => sameName(s.name, stage.name)))
        throw conflict('An active stage already has this name. Rename it first.')
    }
    const [updated] = await tx
      .update(stages)
      .set({ archivedAt: archived ? now : null })
      .where(eq(stages.id, stageId))
      .returning()
    if (!archived) {
      const items = await loadItems(tx, project.id)
      await ensureCells(
        tx,
        items.map((i) => ({ itemId: i.id, stageId })),
        now,
        newId,
      )
    }
    await audit(tx, txCtx, {
      projectId: project.id,
      action: archived ? 'stage.archive' : 'stage.restore',
      targetType: 'stage',
      targetId: stageId,
    })
    await notify(tx, txCtx, project.id, 'stage.changed')
    return toStageDto(updated!)
  })
}
