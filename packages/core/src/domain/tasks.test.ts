import { TASK_ACTIONS_NEEDING_REASON, type TaskState } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import {
  aggregateCellStatus,
  availableActions,
  isActiveTask,
  resolveTransition,
  TASK_TRANSITIONS,
} from './tasks'

const req = (state: TaskState) => ({ state, required: true })

describe('aggregateCellStatus', () => {
  it('is todo with no tasks (never a vacuous done)', () => {
    expect(aggregateCellStatus([])).toBe('todo')
  })
  it('is todo while every task is still draft or ready', () => {
    expect(aggregateCellStatus([req('draft'), req('ready')])).toBe('todo')
  })
  it('is doing once any required task has started', () => {
    for (const s of [
      'in_progress',
      'waiting_for_answer',
      'ready_for_acceptance',
      'changes_requested',
    ] as const) {
      expect(aggregateCellStatus([req(s), req('draft')])).toBe('doing')
    }
  })
  it('is doing when one of two required tasks is accepted (AC-13)', () => {
    expect(aggregateCellStatus([req('done'), req('ready')])).toBe('doing')
  })
  it('is done when every required task is accepted (AC-13)', () => {
    expect(aggregateCellStatus([req('done'), req('done')])).toBe('done')
  })
  it('ignores cancelled and optional tasks', () => {
    expect(aggregateCellStatus([req('done'), req('cancelled')])).toBe('done')
    expect(aggregateCellStatus([req('done'), { state: 'draft', required: false }])).toBe('done')
    expect(aggregateCellStatus([req('cancelled')])).toBe('todo')
    expect(aggregateCellStatus([{ state: 'in_progress', required: false }])).toBe('todo')
  })
  it('goes back to doing when an accepted task is reopened (AC-14)', () => {
    expect(aggregateCellStatus([req('changes_requested'), req('done')])).toBe('doing')
  })
})

describe('isActiveTask', () => {
  it('counts only required tasks that are neither done nor cancelled', () => {
    expect(isActiveTask(req('in_progress'))).toBe(true)
    expect(isActiveTask(req('done'))).toBe(false)
    expect(isActiveTask(req('cancelled'))).toBe(false)
    expect(isActiveTask({ state: 'draft', required: false })).toBe(false)
  })
})

describe('resolveTransition', () => {
  it('walks the happy path', () => {
    let state: TaskState = 'draft'
    for (const [action, to] of [
      ['mark_ready', 'ready'],
      ['start', 'in_progress'],
      ['submit', 'ready_for_acceptance'],
      ['accept', 'done'],
    ] as const) {
      const r = resolveTransition(action, state)
      expect(r).toMatchObject({ ok: true, to })
      state = to
    }
  })
  it('rejects actions from the wrong state', () => {
    expect(resolveTransition('accept', 'in_progress')).toMatchObject({ ok: false })
    expect(resolveTransition('start', 'draft')).toMatchObject({ ok: false })
    expect(resolveTransition('cancel', 'done')).toMatchObject({ ok: false })
  })
  it('requires a reason to reopen, request changes and cancel', () => {
    expect(resolveTransition('reopen', 'done')).toMatchObject({ ok: true, reasonRequired: true })
    expect(resolveTransition('request_changes', 'ready_for_acceptance')).toMatchObject({
      reasonRequired: true,
    })
    expect(resolveTransition('cancel', 'draft')).toMatchObject({ reasonRequired: true })
    expect(resolveTransition('accept', 'ready_for_acceptance')).toMatchObject({
      reasonRequired: false,
    })
  })
  it('restores a cancelled task as a draft', () => {
    expect(resolveTransition('restore', 'cancelled')).toMatchObject({ ok: true, to: 'draft' })
  })
})

describe('availableActions', () => {
  it('lists what a human can do next', () => {
    expect(availableActions('draft')).toEqual(['mark_ready', 'cancel'])
    expect(availableActions('done')).toEqual(['reopen'])
    expect(availableActions('cancelled')).toEqual(['restore'])
    expect(availableActions('ready_for_acceptance')).toEqual([
      'accept',
      'request_changes',
      'cancel',
    ])
  })
})

describe('shared reason list', () => {
  it('matches the actions that require a reason', () => {
    const required = (Object.keys(TASK_TRANSITIONS) as (keyof typeof TASK_TRANSITIONS)[]).filter(
      (a) => TASK_TRANSITIONS[a].reasonRequired,
    )
    expect([...TASK_ACTIONS_NEEDING_REASON].sort()).toEqual(required.sort())
  })
})
