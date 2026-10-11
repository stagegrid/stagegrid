import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildCodexArgs,
  CodexAdapter,
  parseRateLimits,
  readCodexRateLimits,
} from '../src/adapters/codex'
import type { AdapterEvent, AdapterInput } from '../src/adapters/types'
import { fakeCli, jsonl } from './helpers'

const input = (extra: Partial<AdapterInput> = {}): AdapterInput => ({
  cwd: process.cwd(),
  prompt: 'Do the task',
  systemPrompt: 'You are Mali',
  model: null,
  sessionRef: null,
  env: {},
  gitDir: '/repo/.git',
  ...extra,
})

// The shape Codex wrote to a session file (codex 0.154), with its own numbers.
const RATE_LIMITS = {
  limit_id: 'codex',
  primary: { used_percent: 47.0, window_minutes: 300, resets_at: 1791678449 },
  secondary: { used_percent: 59.0, window_minutes: 10080, resets_at: 1792007107 },
  rate_limit_reached_type: null,
}

describe('parseRateLimits', () => {
  it('maps primary to the 5-hour window and secondary to the weekly one', () => {
    expect(parseRateLimits(RATE_LIMITS)).toEqual({
      fiveHour: { percent: 47, resetsAt: new Date(1791678449 * 1000).toISOString() },
      weekly: { percent: 59, resetsAt: new Date(1792007107 * 1000).toISOString() },
      reachedType: null,
    })
  })
  it('keeps the reached marker and ignores empty data', () => {
    expect(
      parseRateLimits({ ...RATE_LIMITS, rate_limit_reached_type: 'primary' })?.reachedType,
    ).toBe('primary')
    expect(parseRateLimits(null)).toBeNull()
    expect(parseRateLimits({ primary: null, secondary: null })).toBeNull()
  })
})

describe('readCodexRateLimits', () => {
  it('reads the newest recorded usage from the session files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sg-codex-home-'))
    const day = join(home, 'sessions', '2026', '10', '11')
    await mkdir(day, { recursive: true })
    const line = (rl: unknown) =>
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: rl } })
    await writeFile(
      join(day, 'rollout-2026-10-11T01-00-00-aaa.jsonl'),
      `${line(null)}\n${line(RATE_LIMITS)}\n${line(null)}\n`,
    )
    expect((await readCodexRateLimits(join(home, 'sessions')))?.fiveHour?.percent).toBe(47)
    expect(await readCodexRateLimits(join(home, 'missing'))).toBeNull()
  })
})

describe('buildCodexArgs', () => {
  it('starts in the worktree with a writable sandbox and the repository git dir', () => {
    const a = buildCodexArgs(input(), '/tmp/schema.json', false, 'gpt-5')
    expect(a.slice(0, 2)).toEqual(['exec', '--json'])
    expect(a).toEqual(
      expect.arrayContaining([
        '-s',
        'workspace-write',
        '--add-dir',
        '/repo/.git',
        '--ignore-user-config',
        '-m',
        'gpt-5',
      ]),
    )
    expect(a.at(-1)).toBe('-')
  })
  it('resumes by thread id', () => {
    const a = buildCodexArgs(input({ sessionRef: 'thread-1' }), '/tmp/s.json', true, null)
    expect(a.slice(0, 2)).toEqual(['exec', 'resume'])
    expect(a.at(-2)).toBe('thread-1')
  })
})

describe('CodexAdapter.run with a fake CLI', () => {
  const run = async (script: string, signal = new AbortController().signal) => {
    const { bin } = await fakeCli('codex', script)
    const events: AdapterEvent[] = []
    const home = await mkdtemp(join(tmpdir(), 'sg-codex-home-'))
    const outcome = await new CodexAdapter({ bin, codexHome: home }).run(input(), signal, (e) =>
      events.push(e),
    )
    return { outcome, events }
  }
  const result = JSON.stringify({
    status: 'submitted',
    summary: 'Shipped',
    commit: 'abc',
    tests: '8 passed',
  })

  it('captures the thread, progress and the structured result', async () => {
    const { outcome, events } = await run(
      jsonl(
        { type: 'thread.started', thread_id: 'th-1' },
        { type: 'item.completed', item: { type: 'agent_message', text: result } },
        { type: 'turn.completed', usage: { input_tokens: 1 } },
      ),
    )
    expect(outcome).toMatchObject({ kind: 'finished', summary: 'Shipped', commit: 'abc' })
    expect(events[0]).toEqual({ type: 'session', sessionRef: 'th-1' })
  })

  it('sends the role rules and the task on stdin', async () => {
    const { outcome } = await run(
      `let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
         const ok=d.includes('You are Mali')&&d.includes('Do the task');
         const msg=JSON.stringify({status:ok?'submitted':'blocked',summary:ok?'got it':'missing',commit:null,tests:null});
         console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:msg}}));
         console.log(JSON.stringify({type:'turn.completed'}))})`,
    )
    expect(outcome).toMatchObject({ kind: 'finished', summary: 'got it' })
  })

  it('treats a stream that just ends as interrupted, as Codex does on cancel', async () => {
    const { outcome } = await run(jsonl({ type: 'thread.started', thread_id: 'th' }))
    expect(outcome).toMatchObject({ kind: 'interrupted' })
  })

  it('fails on an error and on an answer that is not the structured result', async () => {
    const failed = await run(jsonl({ type: 'turn.failed', error: { message: 'Model exploded' } }))
    expect(failed.outcome).toEqual({ kind: 'failed', reason: 'Model exploded' })
    const prose = await run(
      jsonl(
        { type: 'item.completed', item: { type: 'agent_message', text: 'All done!' } },
        { type: 'turn.completed' },
      ),
    )
    expect(prose.outcome).toMatchObject({ kind: 'failed' })
  })

  it('recognises a usage limit', async () => {
    const { outcome } = await run(
      jsonl({
        type: 'turn.failed',
        error: { message: "You've hit your usage limit. Try again later." },
      }),
    )
    expect(outcome).toMatchObject({ kind: 'capacity' })
  })

  it('stops the process when aborted', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 300)
    const { outcome } = await run('setInterval(() => {}, 1000)', controller.signal)
    expect(outcome).toMatchObject({ kind: 'interrupted' })
  })
})
