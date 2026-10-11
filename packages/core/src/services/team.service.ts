import { DEFAULT_ROLE_STAGES, type EmployeeRole, type TeamSettingsInput } from '@stagegrid/shared'
import { and, eq, inArray } from 'drizzle-orm'

import type { DbOrTx } from '../db/client'
import { employees, projects } from '../db/schema'
import { invalid } from '../errors'
import { notify } from '../realtime/notify'
import { type ProjectRow, requireProjectRole } from './access'
import { audit } from './audit'
import { type ServiceContext, withTx } from './context'
import { loadStages, type StageRow } from './structure'

export type StageRole = 'analyst' | 'dev' | 'qa'

/** The stage a role works on: the one the project mapped, or the stage with the usual name. */
export function resolveRoleStage(
  project: Pick<ProjectRow, 'team'>,
  stages: StageRow[],
  role: StageRole,
): StageRow | null {
  const mapped = project.team[role].stageId
  if (mapped) return stages.find((s) => s.id === mapped) ?? null
  const wanted = DEFAULT_ROLE_STAGES[role].toLowerCase()
  return stages.find((s) => s.name.toLowerCase() === wanted) ?? null
}

const ROLE_LABEL: Record<EmployeeRole, string> = {
  analyst: 'Analyst',
  dev: 'Dev',
  reviewer: 'Reviewer',
  qa: 'QA',
}

/**
 * Sets who does which role. Each chosen employee must be an active employee of the project with that
 * role, the roles must be held by different employees (a reviewer never checks their own work), and an
 * enabled role needs an employee and, where it works on a stage, a stage that exists.
 */
export async function updateTeam(
  ctx: ServiceContext,
  ref: string,
  input: TeamSettingsInput,
): Promise<ProjectRow['team']> {
  const { project } = await requireProjectRole(ctx, ref, 'owner')
  return withTx(ctx, async (tx, txCtx) => {
    const picks: [EmployeeRole, string | null, boolean][] = [
      ['analyst', input.analyst.employeeId, input.analyst.enabled],
      ['dev', input.dev.employeeId, true],
      ['reviewer', input.reviewer.employeeId, input.reviewer.enabled],
      ['qa', input.qa.employeeId, input.qa.enabled],
    ]
    const ids = picks.flatMap(([, id]) => (id ? [id] : []))
    if (new Set(ids).size !== ids.length)
      throw invalid(
        'One employee can hold only one role in the team, so nobody checks their own work.',
      )
    const found = ids.length
      ? await tx
          .select()
          .from(employees)
          .where(and(eq(employees.projectId, project.id), inArray(employees.id, ids)))
      : []
    for (const [role, id, enabled] of picks) {
      if (!id) {
        if (enabled && role !== 'dev')
          throw invalid(`${ROLE_LABEL[role]} is on, so pick who plays it.`)
        continue
      }
      const e = found.find((x) => x.id === id)
      if (!e) throw invalid(`The ${ROLE_LABEL[role]} must be an employee of this project.`)
      if (e.archivedAt)
        throw invalid(`${e.displayName} is archived and can't take the ${ROLE_LABEL[role]} role.`)
      if (e.role !== role)
        throw invalid(
          `${e.displayName} is a ${ROLE_LABEL[e.role]}, so can't be the ${ROLE_LABEL[role]}.`,
        )
    }
    const stageRows = await loadStages(tx, project.id)
    const next = { ...project, team: input }
    for (const role of ['analyst', 'dev', 'qa'] as const) {
      const wanted =
        role === 'dev'
          ? input.analyst.enabled ||
            input.reviewer.enabled ||
            input.qa.enabled ||
            input.dev.employeeId !== null
          : input[role].enabled
      if (input[role].stageId && !stageRows.some((s) => s.id === input[role].stageId))
        throw invalid(`The ${ROLE_LABEL[role]} stage doesn't exist in this project.`)
      if (wanted && !resolveRoleStage(next, stageRows, role))
        throw invalid(
          `There is no "${DEFAULT_ROLE_STAGES[role]}" stage for the ${ROLE_LABEL[role]}. Pick the stage they work on.`,
        )
    }
    const [row] = await tx
      .update(projects)
      .set({ team: input, updatedAt: ctx.now() })
      .where(eq(projects.id, project.id))
      .returning()
    await audit(tx, txCtx, {
      projectId: project.id,
      action: 'project.team',
      targetType: 'project',
      targetId: project.id,
      before: project.team,
      after: input,
    })
    await notify(tx, txCtx, project.id, 'project.updated')
    return row!.team
  })
}

/** The employees currently doing each role, for work that needs to be handed to them. */
export async function teamEmployees(db: DbOrTx, project: ProjectRow) {
  const ids = [
    project.team.analyst.employeeId,
    project.team.dev.employeeId,
    project.team.reviewer.employeeId,
    project.team.qa.employeeId,
  ].filter((x): x is string => !!x)
  const rows = ids.length ? await db.select().from(employees).where(inArray(employees.id, ids)) : []
  return new Map(rows.map((r) => [r.id, r]))
}
