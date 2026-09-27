import { describe, expect, it } from 'vitest'

import { displayStatus, releaseRisks, type RiskCell } from './release-risk'

const cell = (over: Partial<RiskCell>): RiskCell => ({
  cellId: 'c',
  item: 'Login',
  stage: 'Implement',
  status: 'todo',
  plannedEnd: null,
  ...over,
})
const sit = { name: 'SIT', plannedStart: '2026-11-01', freeze: true }

describe('releaseRisks', () => {
  it('flags a passed target', () => {
    expect(
      releaseRisks({ targetDate: '2026-10-01', phases: [], cells: [], today: '2026-10-02' }).map(
        (r) => r.code,
      ),
    ).toEqual(['past_target'])
  })
  it('flags plans after the target and after the freeze phase', () => {
    const risks = releaseRisks({
      targetDate: '2026-11-25',
      phases: [sit],
      cells: [cell({ status: 'doing', plannedEnd: '2026-11-30' })],
      today: '2026-10-01',
    })
    expect(risks.map((r) => r.code)).toEqual(['planned_after_target', 'planned_after_freeze'])
    expect(risks[1]!.message).toBe(
      'Login › Implement is planned to finish 2026-11-30, after SIT starts',
    )
  })
  it('flags work not started within a week of the freeze', () => {
    const base = { targetDate: '2026-11-25', phases: [sit], cells: [cell({})] }
    expect(releaseRisks({ ...base, today: '2026-10-24' })).toEqual([])
    expect(releaseRisks({ ...base, today: '2026-10-25' }).map((r) => r.code)).toEqual([
      'not_started_near_freeze',
    ])
  })
  it('without a freeze phase, warns two weeks before the target', () => {
    const base = { targetDate: '2026-11-25', phases: [], cells: [cell({})] }
    expect(releaseRisks({ ...base, today: '2026-11-10' })).toEqual([])
    expect(releaseRisks({ ...base, today: '2026-11-11' }).map((r) => r.code)).toEqual([
      'not_started_near_target',
    ])
  })
  it('ignores done and skipped cells', () => {
    const cells = [cell({ status: 'done', plannedEnd: '2026-12-31' }), cell({ status: 'skip' })]
    expect(
      releaseRisks({ targetDate: '2026-11-25', phases: [sit], cells, today: '2026-11-20' }),
    ).toEqual([])
  })
})

describe('displayStatus', () => {
  it('derives planned / in progress / at risk', () => {
    expect(displayStatus('active', 0, [{ status: 'todo' }])).toBe('planned')
    expect(displayStatus('active', 0, [{ status: 'doing' }])).toBe('in_progress')
    expect(displayStatus('active', 2, [{ status: 'todo' }])).toBe('at_risk')
    expect(displayStatus('released', 2, [])).toBe('released')
  })
})
