import { describe, expect, it } from 'vitest'

import {
  buildClaudeArgs,
  classifyClaude,
  ClaudeAdapter,
  readRateLimit,
  toIso,
} from '../src/adapters/claude'
import type { AdapterEvent, AdapterInput } from '../src/adapters/types'
import { fakeCli, jsonl } from './helpers'

const input = (extra: Partial<AdapterInput> = {}): AdapterInput => ({
  cwd: process.cwd(),
  prompt: 'Do the task',
  systemPrompt: 'You are Mali',
  model: 'sonnet',
  sessionRef: null,
  env: {},
  gitDir: '/repo/.git',
  ...extra,
})

// A real result from `claude -p` stopped by --max-budget-usd (Claude Code 2.1.263), trimmed.
const BUDGET_RESULT = {
  type: 'result',
  subtype: 'error_max_budget_usd',
  is_error: true,
  terminal_reason: 'budget_exhausted',
  errors: ['Reached maximum budget ($0.05)'],
  total_cost_usd: 0.091464,
  num_turns: 1,
}

describe('buildClaudeArgs', () => {
  it('pre-assigns the session for a new run and resumes it for a continuation', () => {
    const fresh = buildClaudeArgs(input(), 'abc', false, {})
    expect(fresh).toContain('--session-id')
    expect(fresh).not.toContain('--resume')
    const resumed = buildClaudeArgs(input({ sessionRef: 'abc' }), 'abc', true, {})
    expect(resumed.slice(resumed.indexOf('--resume'), resumed.indexOf('--resume') + 2)).toEqual([
      '--resume',
      'abc',
    ])
  })

  it('isolates the run from the user setup, forbids publishing and caps the budget', () => {
    const a = buildClaudeArgs(input(), 's', false, { maxBudgetUsd: 2 })
    expect(a).toEqual(
      expect.arrayContaining([
        '--strict-mcp-config',
        '--disable-slash-commands',
        '--setting-sources',
        'project',
      ]),
    )
    expect(a.slice(a.indexOf('--disallowedTools'))).toEqual(
      expect.arrayContaining(['Bash(git push*)', 'WebFetch']),
    )
    expect(a[a.indexOf('--max-budget-usd') + 1]).toBe('2')
    expect(a.at(-1)).toBe('Do the task')
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
  })
})

describe('classifyClaude', () => {
  const ok = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.2 }

  it('finishes when the structured result is valid', () => {
    const r = classifyClaude(
      {
        ...ok,
        structured_output: {
          status: 'submitted',
          summary: 'Done',
          commit: 'abc123',
          tests: '9 passed',
        },
      },
      null,
      0,
      '',
    )
    expect(r).toMatchObject({
      kind: 'finished',
      summary: 'Done',
      commit: 'abc123',
      blocked: false,
      costUsd: 0.2,
    })
  })

  it('reports a blocked agent as finished-but-blocked', () => {
    const r = classifyClaude(
      {
        ...ok,
        structured_output: {
          status: 'blocked',
          summary: 'Need the rule',
          commit: null,
          tests: null,
        },
      },
      null,
      0,
      '',
    )
    expect(r).toMatchObject({ kind: 'finished', blocked: true })
  })

  it('never trusts a "success" without the structured result', () => {
    expect(classifyClaude({ ...ok }, null, 0, '')).toMatchObject({ kind: 'failed' })
    expect(
      classifyClaude({ ...ok, structured_output: { status: 'done' } }, null, 0, ''),
    ).toMatchObject({
      kind: 'failed',
    })
  })

  it('treats a stopped budget as a failure with the reason (real Claude result)', () => {
    expect(classifyClaude(BUDGET_RESULT, null, 1, '', 0.05)).toEqual({
      kind: 'failed',
      reason: 'Reached maximum budget ($0.05)',
    })
  })

  it('treats an aborted stream as interrupted, never as success', () => {
    expect(
      classifyClaude(
        { type: 'result', subtype: 'error_during_execution', terminal_reason: 'aborted_streaming' },
        null,
        0,
        '',
      ),
    ).toMatchObject({ kind: 'interrupted' })
    expect(classifyClaude(null, null, 1, 'killed')).toMatchObject({ kind: 'interrupted' })
  })

  it('recognises a usage limit and carries the reset time', () => {
    const limit = readRateLimit({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', resetsAt: 1791678449, rateLimitType: 'five_hour' },
    })
    expect(
      classifyClaude(
        { type: 'result', subtype: 'error', is_error: true, result: 'Usage limit reached' },
        limit,
        1,
        '',
      ),
    ).toEqual({
      kind: 'capacity',
      resetsAt: new Date(1791678449 * 1000).toISOString(),
      window: null,
      message: 'Usage limit reached',
    })
    expect(classifyClaude(null, null, 1, 'Claude usage limit reached')).toMatchObject({
      kind: 'capacity',
    })
  })
})

describe('readRateLimit', () => {
  it('finds status, reset and both windows wherever they are, as fractions or percents', () => {
    const r = readRateLimit({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: '2026-10-20T08:00:00Z',
        unifiedWindows: {
          five_hour: { utilization: 0.34, resetsAt: 1791678449 },
          seven_day: { utilization: 5 },
        },
      },
    })
    expect(r.status).toBe('allowed')
    expect(r.fiveHour).toEqual({ percent: 34, resetsAt: new Date(1791678449 * 1000).toISOString() })
    expect(r.weekly).toEqual({ percent: 5, resetsAt: null })
  })

  it('normalises times', () => {
    expect(toIso(1791678449)).toBe('2026-10-11T00:27:29.000Z')
    expect(toIso('2026-10-20T08:00:00Z')).toBe('2026-10-20T08:00:00.000Z')
    expect(toIso('nope')).toBeNull()
  })
})

describe('ClaudeAdapter.run with a fake CLI', () => {
  const run = async (
    script: string,
    signal = new AbortController().signal,
    sessionRef: string | null = null,
  ) => {
    const { bin } = await fakeCli('claude', script)
    const events: AdapterEvent[] = []
    const outcome = await new ClaudeAdapter({ bin }).run(input({ sessionRef }), signal, (e) =>
      events.push(e),
    )
    return { outcome, events }
  }

  it('streams progress and returns the structured result', async () => {
    const { outcome, events } = await run(
      jsonl(
        { type: 'system', subtype: 'init', session_id: 'x' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the code' }] } },
        {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }] },
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          structured_output: {
            status: 'submitted',
            summary: 'All good',
            commit: 'abc',
            tests: 'ok',
          },
        },
      ),
    )
    expect(outcome).toMatchObject({ kind: 'finished', summary: 'All good', commit: 'abc' })
    expect(events[0]).toMatchObject({ type: 'session' })
    expect(events).toContainEqual({ type: 'progress', message: 'Reading the code' })
    expect(events).toContainEqual({ type: 'log', message: 'Edit a.ts' })
  })

  it('resumes the given session', async () => {
    const { outcome, events } = await run(
      `const a = process.argv.slice(2); const i = a.indexOf('--resume');
       process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,
         structured_output:{status:'submitted',summary:'resumed '+(i>=0?a[i+1]:'none'),commit:null,tests:null}})+'\\n')`,
      new AbortController().signal,
      'sess-7',
    )
    expect(outcome).toMatchObject({ kind: 'finished', summary: 'resumed sess-7' })
    expect(events[0]).toEqual({ type: 'session', sessionRef: 'sess-7' })
  })

  it('forwards the usage it sees', async () => {
    const { events } = await run(
      jsonl(
        {
          type: 'rate_limit_event',
          rate_limit_info: {
            status: 'allowed',
            unifiedWindows: { five_hour: { utilization: 0.5 } },
          },
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          structured_output: { status: 'submitted', summary: 's', commit: null, tests: null },
        },
      ),
    )
    expect(events).toContainEqual({
      type: 'capacity',
      fiveHour: { percent: 50, resetsAt: null },
      weekly: null,
    })
  })

  it('stops the process when aborted and reports interrupted', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const { outcome } = await run('setInterval(() => {}, 1000)', controller.signal)
    expect(outcome).toMatchObject({ kind: 'interrupted' })
  })

  it('reports an unusable CLI instead of throwing', async () => {
    const r = await new ClaudeAdapter({ bin: '/nonexistent/claude' }).check()
    expect(r.ok).toBe(false)
  })
})
