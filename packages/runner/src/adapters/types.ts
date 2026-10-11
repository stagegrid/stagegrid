import type { UsageWindow } from '@stagegrid/shared'

/** What the adapter tells the loop while it works. The loop turns these into Stagegrid run events. */
export type AdapterEvent =
  | { type: 'session'; sessionRef: string }
  | { type: 'progress'; message: string }
  | { type: 'log'; message: string }
  | { type: 'capacity'; fiveHour: UsageWindow | null; weekly: UsageWindow | null }

export interface AdapterInput {
  /** The task's worktree; the agent works only here. */
  cwd: string
  prompt: string
  /** Role instructions plus the employee's own. */
  systemPrompt: string
  model: string | null
  /** The provider's session handle from an earlier attempt, to continue the same conversation. */
  sessionRef: string | null
  /** Identity for commits the agent makes. */
  env: Record<string, string>
  /** The repository's .git directory, which a worktree commit needs to write to. */
  gitDir: string
}

export type AdapterOutcome =
  /** The agent can't continue without decisions it needs from people; it asks them all at once. */
  | { kind: 'needs_answers'; summary: string; questions: { prompt: string; options: string[] }[] }
  /** The agent finished and returned its structured result. */
  | {
      kind: 'finished'
      summary: string
      blocked: boolean
      commit: string | null
      tests: string | null
      costUsd: number | null
    }
  /** The provider's usage limit stopped the work; continue after `resetsAt`. */
  | {
      kind: 'capacity'
      resetsAt: string | null
      window: 'fiveHour' | 'weekly' | null
      message: string
    }
  /** The process was stopped (cancelled, crashed, or ended without a result). */
  | { kind: 'interrupted'; reason: string }
  /** The agent or CLI reported an error. */
  | { kind: 'failed'; reason: string }

export interface AgentAdapter {
  readonly provider: 'claude_code' | 'codex'
  /** Is the CLI installed and usable? Used by `doctor` and before claiming work. */
  check(): Promise<{ ok: boolean; detail: string }>
  run(
    input: AdapterInput,
    signal: AbortSignal,
    onEvent: (e: AdapterEvent) => void,
  ): Promise<AdapterOutcome>
  /** Current usage of the provider account, if it can be read without running anything. */
  readCapacity?(): Promise<{ fiveHour: UsageWindow | null; weekly: UsageWindow | null } | null>
}

/** The result every role's agent must return (Dev for now). Strict, so Codex accepts it as is. */
export const DEV_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['submitted', 'needs_answers', 'blocked'] },
    summary: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['prompt', 'options'],
      },
    },
    commit: { type: ['string', 'null'] },
    tests: { type: ['string', 'null'] },
  },
  required: ['status', 'summary', 'questions', 'commit', 'tests'],
} as const

export interface DevResult {
  status: 'submitted' | 'needs_answers' | 'blocked'
  summary: string
  questions: { prompt: string; options: string[] }[]
  commit: string | null
  tests: string | null
}

export function parseDevResult(value: unknown): DevResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.status !== 'submitted' && v.status !== 'needs_answers' && v.status !== 'blocked')
    return null
  if (typeof v.summary !== 'string') return null
  const questions = Array.isArray(v.questions)
    ? (v.questions as unknown[]).flatMap((q) => {
        if (!q || typeof q !== 'object') return []
        const o = q as Record<string, unknown>
        if (typeof o.prompt !== 'string' || !o.prompt.trim()) return []
        const options = Array.isArray(o.options)
          ? (o.options as unknown[]).filter((x): x is string => typeof x === 'string')
          : []
        return [{ prompt: o.prompt.trim(), options }]
      })
    : []
  return {
    status: v.status,
    summary: v.summary,
    questions,
    commit: typeof v.commit === 'string' ? v.commit : null,
    tests: typeof v.tests === 'string' ? v.tests : null,
  }
}
