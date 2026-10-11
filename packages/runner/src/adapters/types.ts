import type { RunRole, UsageWindow } from '@stagegrid/shared'

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
  /** What this run is for; it decides the result the agent must return and what it may touch. */
  role: RunRole
}

export type AdapterOutcome =
  /** A Reviewer's verdict on a delivery. */
  | { kind: 'review'; report: ReviewResult }
  /** QA's verdict and per-criterion results. */
  | { kind: 'qa'; report: QaResult }
  /** An Analyst's requirement documents. */
  | { kind: 'analyst'; summary: string; documents: AnalystDocument[] }
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

export const READ_ONLY_ROLES: readonly RunRole[] = ['reviewer', 'qa', 'analyst']

const findingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'note'] },
    text: { type: 'string' },
    file: { type: ['string', 'null'] },
  },
  required: ['severity', 'text', 'file'],
} as const

export const REVIEW_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'changes_requested'] },
    summary: { type: 'string' },
    findings: { type: 'array', items: findingSchema },
  },
  required: ['verdict', 'summary', 'findings'],
} as const

export const QA_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string' },
    findings: { type: 'array', items: findingSchema },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          criterion: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'not_tested'] },
          evidence: { type: 'string' },
        },
        required: ['criterion', 'result', 'evidence'],
      },
    },
  },
  required: ['verdict', 'summary', 'findings', 'results'],
} as const

export const ANALYST_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['submitted', 'needs_answers', 'blocked'] },
    summary: { type: 'string' },
    questions: DEV_RESULT_SCHEMA.properties.questions,
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          template: { type: 'string' },
          title: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { id: { type: 'string' }, content: { type: 'string' } },
              required: ['id', 'content'],
            },
          },
        },
        required: ['template', 'title', 'sections'],
      },
    },
  },
  required: ['status', 'summary', 'questions', 'documents'],
} as const

export function schemaForRole(role: RunRole): object {
  if (role === 'reviewer') return REVIEW_RESULT_SCHEMA
  if (role === 'qa') return QA_RESULT_SCHEMA
  if (role === 'analyst') return ANALYST_RESULT_SCHEMA
  return DEV_RESULT_SCHEMA
}

export interface Finding {
  severity: 'blocker' | 'major' | 'minor' | 'note'
  text: string
  file: string | null
}
export interface ReviewResult {
  verdict: 'pass' | 'changes_requested'
  summary: string
  findings: Finding[]
}
export interface QaResult {
  verdict: 'pass' | 'fail'
  summary: string
  findings: Finding[]
  results: { criterion: string; result: 'pass' | 'fail' | 'not_tested'; evidence: string }[]
}
export interface AnalystDocument {
  template: string
  title: string
  sections: { id: string; content: string }[]
}

const SEVERITIES = ['blocker', 'major', 'minor', 'note']
function parseFindings(v: unknown): Finding[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((f) => {
    if (!f || typeof f !== 'object') return []
    const o = f as Record<string, unknown>
    if (typeof o.text !== 'string' || !o.text.trim()) return []
    return [
      {
        severity: (SEVERITIES.includes(o.severity as string)
          ? o.severity
          : 'note') as Finding['severity'],
        text: o.text.trim(),
        file: typeof o.file === 'string' && o.file ? o.file : null,
      },
    ]
  })
}

export function parseReviewResult(value: unknown): ReviewResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.verdict !== 'pass' && v.verdict !== 'changes_requested') return null
  return {
    verdict: v.verdict,
    summary: typeof v.summary === 'string' ? v.summary : '',
    findings: parseFindings(v.findings),
  }
}

export function parseQaResult(value: unknown): QaResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.verdict !== 'pass' && v.verdict !== 'fail') return null
  const results = Array.isArray(v.results)
    ? (v.results as unknown[]).flatMap((r) => {
        if (!r || typeof r !== 'object') return []
        const o = r as Record<string, unknown>
        if (typeof o.criterion !== 'string' || !o.criterion.trim()) return []
        const result = o.result === 'pass' || o.result === 'fail' ? o.result : 'not_tested'
        return [
          {
            criterion: o.criterion.trim(),
            result,
            evidence: typeof o.evidence === 'string' ? o.evidence : '',
          } as QaResult['results'][number],
        ]
      })
    : []
  return {
    verdict: v.verdict,
    summary: typeof v.summary === 'string' ? v.summary : '',
    findings: parseFindings(v.findings),
    results,
  }
}

export function parseAnalystResult(value: unknown): {
  status: 'submitted' | 'needs_answers' | 'blocked'
  summary: string
  questions: DevResult['questions']
  documents: AnalystDocument[]
} | null {
  const base = parseDevResult(value)
  if (!base) return null
  const raw = (value as Record<string, unknown>).documents
  const documents: AnalystDocument[] = Array.isArray(raw)
    ? (raw as unknown[]).flatMap((d) => {
        if (!d || typeof d !== 'object') return []
        const o = d as Record<string, unknown>
        if (typeof o.template !== 'string' || !Array.isArray(o.sections)) return []
        const sections = (o.sections as unknown[]).flatMap((x) => {
          const sx = x as Record<string, unknown>
          return typeof sx?.id === 'string' && typeof sx.content === 'string'
            ? [{ id: sx.id, content: sx.content }]
            : []
        })
        return sections.length
          ? [{ template: o.template, title: typeof o.title === 'string' ? o.title : '', sections }]
          : []
      })
    : []
  return { status: base.status, summary: base.summary, questions: base.questions, documents }
}

/**
 * Turns the agent's structured answer into what the loop acts on, for whichever role it played. A
 * "success" without the right shape is a failure: nothing is accepted on the agent's say-so.
 */
export function outcomeFromStructured(
  role: RunRole,
  value: unknown,
  costUsd: number | null,
): AdapterOutcome {
  const bad = (what: string): AdapterOutcome => ({
    kind: 'failed',
    reason: `The agent finished without the required ${what}.`,
  })
  if (role === 'reviewer') {
    const r = parseReviewResult(value)
    return r ? { kind: 'review', report: r } : bad('review verdict')
  }
  if (role === 'qa') {
    const r = parseQaResult(value)
    return r ? { kind: 'qa', report: r } : bad('QA report')
  }
  if (role === 'analyst') {
    const r = parseAnalystResult(value)
    if (!r) return bad('structured result')
    if (r.status === 'needs_answers')
      return r.questions.length
        ? { kind: 'needs_answers', summary: r.summary, questions: r.questions }
        : { kind: 'failed', reason: 'The agent asked for answers but listed no questions.' }
    if (r.status === 'blocked')
      return {
        kind: 'finished',
        summary: r.summary,
        blocked: true,
        commit: null,
        tests: null,
        costUsd,
      }
    return r.documents.length
      ? { kind: 'analyst', summary: r.summary, documents: r.documents }
      : { kind: 'failed', reason: 'The analyst submitted no requirement document.' }
  }
  const parsed = parseDevResult(value)
  if (!parsed) return bad('structured result')
  if (parsed.status === 'needs_answers')
    return parsed.questions.length
      ? { kind: 'needs_answers', summary: parsed.summary, questions: parsed.questions }
      : { kind: 'failed', reason: 'The agent asked for answers but listed no questions.' }
  return {
    kind: 'finished',
    summary: parsed.summary,
    blocked: parsed.status === 'blocked',
    commit: parsed.commit,
    tests: parsed.tests,
    costUsd,
  }
}
