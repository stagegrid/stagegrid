import {
  addDays,
  type CellStatus,
  type ReleaseDisplayStatus,
  type ReleaseRiskDto,
} from '@stagegrid/shared'

export interface RiskPhase {
  name: string
  plannedStart: string | null
  freeze: boolean
}

export interface RiskCell {
  cellId: string
  item: string
  stage: string
  status: CellStatus
  plannedEnd: string | null
}

const FREEZE_WARNING_DAYS = 7
const TARGET_WARNING_DAYS = 14

/** Spec 07 §3 risk rules, for active releases. `today` is in the project's time zone. */
export function releaseRisks(input: {
  targetDate: string
  phases: RiskPhase[]
  cells: RiskCell[]
  today: string
}): ReleaseRiskDto[] {
  const { targetDate, phases, cells, today } = input
  const risks: ReleaseRiskDto[] = []
  if (today > targetDate)
    risks.push({ code: 'past_target', message: `Target date ${targetDate} has passed` })
  const freeze = phases.find((p) => p.freeze && p.plannedStart)
  for (const c of cells) {
    if (c.status === 'done' || c.status === 'skip') continue
    const where = { cellId: c.cellId, item: c.item, stage: c.stage }
    const label = `${c.item} › ${c.stage}`
    if (c.plannedEnd && c.plannedEnd > targetDate) {
      risks.push({
        code: 'planned_after_target',
        message: `${label} is planned to finish ${c.plannedEnd}, after the target date`,
        ...where,
      })
    }
    if (freeze && c.plannedEnd && c.plannedEnd >= freeze.plannedStart!) {
      risks.push({
        code: 'planned_after_freeze',
        message: `${label} is planned to finish ${c.plannedEnd}, after ${freeze.name} starts`,
        ...where,
      })
    }
    if (c.status === 'todo') {
      if (freeze && today >= addDays(freeze.plannedStart!, -FREEZE_WARNING_DAYS)) {
        risks.push({
          code: 'not_started_near_freeze',
          message: `${label} hasn't started and ${freeze.name} starts ${freeze.plannedStart}`,
          ...where,
        })
      } else if (!freeze && today >= addDays(targetDate, -TARGET_WARNING_DAYS)) {
        risks.push({
          code: 'not_started_near_target',
          message: `${label} hasn't started and the target is ${targetDate}`,
          ...where,
        })
      }
    }
  }
  return risks
}

export function displayStatus(
  status: 'active' | 'released' | 'cancelled',
  riskCount: number,
  cells: { status: CellStatus }[],
): ReleaseDisplayStatus {
  if (status !== 'active') return status
  if (riskCount > 0) return 'at_risk'
  return cells.some((c) => c.status === 'doing' || c.status === 'done') ? 'in_progress' : 'planned'
}
