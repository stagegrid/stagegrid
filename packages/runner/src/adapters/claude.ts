import { randomUUID } from 'node:crypto'

import type { UsageWindow } from '@stagegrid/shared'

import { spawnStreaming } from '../process'
import {
  type AdapterEvent,
  type AdapterInput,
  type AdapterOutcome,
  type AgentAdapter,
  DEV_RESULT_SCHEMA,
  parseDevResult,
} from './types'

export interface ClaudeOptions {
  bin?: string
  maxBudgetUsd?: number
  allowedTools?: string[]
}

const DEFAULT_ALLOWED = [
  'Read',
  'Edit',
  'Write',
  'Grep',
  'Glob',
  'Bash(git *)',
  'Bash(npm *)',
  'Bash(npx *)',
  'Bash(pnpm *)',
  'Bash(node *)',
]
/** Whatever the allowlist says, the agent may never publish. */
const ALWAYS_DENIED = ['Bash(git push*)', 'Bash(git remote*)', 'WebFetch', 'WebSearch']

const LIMIT_TEXT = /usage limit|limit reached|rate.?limit|too many requests|quota/i
const LIMITED_STATUS = new Set(['rejected', 'blocked', 'exceeded', 'limit_reached', 'limited'])

export function buildClaudeArgs(
  input: AdapterInput,
  sessionId: string,
  resume: boolean,
  opts: ClaudeOptions,
): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose']
  if (input.model) args.push('--model', input.model)
  args.push(resume ? '--resume' : '--session-id', sessionId)
  args.push(
    '--json-schema',
    JSON.stringify(DEV_RESULT_SCHEMA),
    '--append-system-prompt',
    input.systemPrompt,
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    ...(opts.allowedTools ?? DEFAULT_ALLOWED),
    '--disallowedTools',
    ...ALWAYS_DENIED,
    // Keep user hooks, plugins, MCP servers and slash commands out of an unattended run.
    '--setting-sources',
    'project',
    '--strict-mcp-config',
    '--disable-slash-commands',
  )
  if (opts.maxBudgetUsd) args.push('--max-budget-usd', String(opts.maxBudgetUsd))
  args.push(input.prompt)
  return args
}

/** Epoch seconds, epoch milliseconds or an ISO string -> ISO string. */
export function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e11 ? v * 1000 : v
    return new Date(ms).toISOString()
  }
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

const percentOf = (u: number): number => Math.round((u <= 1 ? u * 100 : u) * 10) / 10

export interface RateLimitReading {
  status: string | null
  resetsAt: string | null
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
}

/**
 * Reads Claude's `rate_limit_event`. The shape isn't documented, so this looks for the pieces it
 * needs (status, reset time, five-hour and seven-day utilization) wherever they are in the event.
 */
export function readRateLimit(event: unknown): RateLimitReading {
  const found: RateLimitReading = { status: null, resetsAt: null, fiveHour: null, weekly: null }
  const window = (w: unknown): UsageWindow | null => {
    if (!w || typeof w !== 'object') return null
    const o = w as Record<string, unknown>
    const u = o.utilization ?? o.used_percent ?? o.percent
    if (typeof u !== 'number') return null
    return { percent: percentOf(u), resetsAt: toIso(o.resetsAt ?? o.resets_at) }
  }
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 6) return
    const o = v as Record<string, unknown>
    if (typeof o.status === 'string' && found.status === null) found.status = o.status
    if (o.resetsAt !== undefined && found.resetsAt === null) found.resetsAt = toIso(o.resetsAt)
    if (o.five_hour !== undefined) found.fiveHour ??= window(o.five_hour)
    if (o.seven_day !== undefined) found.weekly ??= window(o.seven_day)
    for (const child of Object.values(o)) walk(child, depth + 1)
  }
  walk(event, 0)
  return found
}

export class ClaudeAdapter implements AgentAdapter {
  readonly provider = 'claude_code' as const
  constructor(private readonly opts: ClaudeOptions = {}) {}

  private get bin() {
    return this.opts.bin ?? 'claude'
  }

  async check() {
    try {
      let out = ''
      const r = await spawnStreaming(this.bin, ['--version'], {
        cwd: process.cwd(),
        onLine: (l) => (out += l),
      })
      return r.code === 0
        ? { ok: true, detail: out || 'claude is installed' }
        : { ok: false, detail: r.stderr.trim() || `claude --version exited ${r.code}` }
    } catch (e) {
      return { ok: false, detail: `Couldn't run "${this.bin}": ${(e as Error).message}` }
    }
  }

  async run(
    input: AdapterInput,
    signal: AbortSignal,
    onEvent: (e: AdapterEvent) => void,
  ): Promise<AdapterOutcome> {
    const resume = input.sessionRef !== null
    const sessionId = input.sessionRef ?? randomUUID()
    onEvent({ type: 'session', sessionRef: sessionId })

    let result: Record<string, unknown> | null = null
    let limit: RateLimitReading | null = null
    const textOut: string[] = []

    const proc = await spawnStreaming(
      this.bin,
      buildClaudeArgs(input, sessionId, resume, this.opts),
      {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        signal,
        onLine: (line) => {
          let e: Record<string, unknown>
          try {
            e = JSON.parse(line) as Record<string, unknown>
          } catch {
            return
          }
          if (e.type === 'result') result = e
          else if (e.type === 'rate_limit_event') {
            limit = readRateLimit(e)
            onEvent({ type: 'capacity', fiveHour: limit.fiveHour, weekly: limit.weekly })
          } else if (e.type === 'assistant') {
            const content = ((e.message as { content?: unknown[] } | undefined)?.content ?? []) as {
              type: string
              text?: string
              name?: string
              input?: Record<string, unknown>
            }[]
            for (const c of content) {
              if (c.type === 'text' && c.text?.trim()) {
                textOut.push(c.text)
                onEvent({ type: 'progress', message: c.text.trim().slice(0, 300) })
              } else if (c.type === 'tool_use') {
                const target = (c.input?.file_path ??
                  c.input?.command ??
                  c.input?.pattern ??
                  '') as string
                onEvent({
                  type: 'log',
                  message: `${c.name} ${String(target).slice(0, 120)}`.trim(),
                })
              }
            }
          }
        },
      },
    )

    if (proc.aborted) return { kind: 'interrupted', reason: 'The run was stopped.' }
    return classifyClaude(result, limit, proc.code, proc.stderr, this.opts.maxBudgetUsd)
  }
}

export function classifyClaude(
  result: Record<string, unknown> | null,
  limit: RateLimitReading | null,
  exitCode: number | null,
  stderr: string,
  budget?: number,
): AdapterOutcome {
  const limited = limit?.status != null && LIMITED_STATUS.has(limit.status.toLowerCase())
  const capacity = (message: string): AdapterOutcome => ({
    kind: 'capacity',
    resetsAt: limit?.resetsAt ?? null,
    window: null,
    message,
  })

  if (!result) {
    if (limited || LIMIT_TEXT.test(stderr))
      return capacity(stderr.trim().slice(0, 300) || 'Usage limit reached')
    return {
      kind: 'interrupted',
      reason: `Claude Code ended without a result (exit ${exitCode}).${stderr.trim() ? ` ${stderr.trim().slice(0, 300)}` : ''}`,
    }
  }
  const subtype = String(result.subtype ?? '')
  const terminal = String(result.terminal_reason ?? '')
  const errors = Array.isArray(result.errors)
    ? (result.errors as unknown[]).map(String).join('; ')
    : ''
  const text = typeof result.result === 'string' ? result.result : ''
  const cost = typeof result.total_cost_usd === 'number' ? result.total_cost_usd : null

  if (subtype === 'success' && result.is_error !== true) {
    const parsed = parseDevResult(result.structured_output)
    if (parsed?.status === 'needs_answers')
      return parsed.questions.length
        ? { kind: 'needs_answers', summary: parsed.summary, questions: parsed.questions }
        : { kind: 'failed', reason: 'The agent asked for answers but listed no questions.' }
    if (parsed)
      return {
        kind: 'finished',
        summary: parsed.summary,
        blocked: parsed.status === 'blocked',
        commit: parsed.commit,
        tests: parsed.tests,
        costUsd: cost,
      }
    return { kind: 'failed', reason: 'The agent finished without the required structured result.' }
  }
  if (subtype === 'error_max_budget_usd' || terminal === 'budget_exhausted')
    return {
      kind: 'failed',
      reason: errors || `Reached the budget cap${budget ? ` of $${budget}` : ''}.`,
    }
  if (limited || LIMIT_TEXT.test(`${errors} ${text}`))
    return capacity(errors || text || 'Usage limit reached')
  if (subtype === 'error_during_execution' || terminal === 'aborted_streaming')
    return { kind: 'interrupted', reason: errors || 'Claude Code was interrupted.' }
  return {
    kind: 'failed',
    reason: errors || text || `Claude Code failed (${subtype || 'unknown'}).`,
  }
}
