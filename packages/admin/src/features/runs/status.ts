import { ACTIVE_RUN_STATES, type RunState } from '@stagegrid/shared'

export const RUN_STATE_LABEL: Record<RunState, string> = {
  queued: 'Waiting for a runner',
  running: 'Running',
  waiting_for_answer: 'Waiting for an answer',
  waiting_for_capacity: 'Paused: usage limit',
  succeeded: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
}

export const isActiveRun = (state: RunState | undefined): boolean =>
  state !== undefined && ACTIVE_RUN_STATES.includes(state)

/** Failed and interrupted runs leave the task in progress until a person retries or cancels it. */
export const needsAttention = (state: RunState | undefined): boolean =>
  state === 'failed' || state === 'interrupted'

/** What a run is doing, in the words of the role doing it. */
export const RUN_ROLE_ACTIVITY: Record<string, string> = {
  analyst: 'Drafting the requirements',
  dev: 'Building',
  reviewer: 'Reviewing the delivery',
  qa: 'Testing the accepted commit',
}
