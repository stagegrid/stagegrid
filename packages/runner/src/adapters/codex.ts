import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import type { UsageWindow } from '@stagegrid/shared'

import { spawnStreaming } from '../process'
import { toIso } from './claude'
import {
  type AdapterEvent,
  type AdapterInput,
  type AdapterOutcome,
  type AgentAdapter,
  outcomeFromStructured,
  READ_ONLY_ROLES,
  schemaForRole,
} from './types'

export interface CodexOptions {
  bin?: string
  /** Where Codex keeps its login and session files (CODEX_HOME). */
  codexHome?: string
}

const LIMIT_TEXT =
  /usage limit|limit reached|rate.?limit|too many requests|quota|try again (later|in|after)/i

export interface CodexRateLimits {
  fiveHour: UsageWindow | null
  weekly: UsageWindow | null
  /** Codex sets this when a limit has been hit. */
  reachedType: string | null
}

const FIVE_HOURS = 300
const WEEK = 10_080

/** `rate_limits` from a Codex session file: primary is the 5-hour window, secondary the weekly one. */
export function parseRateLimits(raw: unknown): CodexRateLimits | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const toWindow = (w: unknown): { minutes: number; value: UsageWindow } | null => {
    if (!w || typeof w !== 'object') return null
    const o = w as Record<string, unknown>
    if (typeof o.used_percent !== 'number') return null
    return {
      minutes: typeof o.window_minutes === 'number' ? o.window_minutes : 0,
      value: { percent: o.used_percent, resetsAt: toIso(o.resets_at) },
    }
  }
  const out: CodexRateLimits = {
    fiveHour: null,
    weekly: null,
    reachedType: typeof r.rate_limit_reached_type === 'string' ? r.rate_limit_reached_type : null,
  }
  for (const w of [toWindow(r.primary), toWindow(r.secondary)]) {
    if (!w) continue
    if (w.minutes === WEEK) out.weekly = w.value
    else if (w.minutes === FIVE_HOURS || !out.fiveHour) out.fiveHour = w.value
  }
  return out.fiveHour || out.weekly ? out : null
}

async function newestFiles(dir: string, limit: number): Promise<string[]> {
  const found: { path: string; mtime: number }[] = []
  const walk = async (d: string, depth: number) => {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory() && depth < 4) await walk(p, depth + 1)
      else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl'))
        found.push({ path: p, mtime: (await stat(p)).mtimeMs })
    }
  }
  await walk(dir, 0)
  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((f) => f.path)
}

/** The most recent usage Codex recorded, read from its own session files without running anything. */
export async function readCodexRateLimits(sessionsDir: string): Promise<CodexRateLimits | null> {
  for (const file of await newestFiles(sessionsDir, 5)) {
    const lines = (await readFile(file, 'utf8')).split('\n')
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]!
      if (!line.includes('"rate_limits":{')) continue
      try {
        const parsed = parseRateLimits(
          (JSON.parse(line) as { payload?: { rate_limits?: unknown } }).payload?.rate_limits,
        )
        if (parsed) return parsed
      } catch {
        /* a partial last line; keep looking */
      }
    }
  }
  return null
}

export function buildCodexArgs(
  input: AdapterInput,
  schemaPath: string,
  resume: boolean,
  model: string | null,
): string[] {
  const common = [
    '--json',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--output-schema',
    schemaPath,
  ]
  if (model) common.push('-m', model)
  // Reviewers, QA and analysts only read: the sandbox itself is read-only, whatever the agent tries.
  const sandbox = READ_ONLY_ROLES.includes(input.role) ? 'read-only' : 'workspace-write'
  if (resume)
    return ['exec', 'resume', ...common, '-c', `sandbox_mode="${sandbox}"`, input.sessionRef!, '-']
  return [
    'exec',
    ...common,
    '-C',
    input.cwd,
    '-s',
    sandbox,
    ...(sandbox === 'workspace-write' ? ['--add-dir', input.gitDir] : []),
    '-',
  ]
}

export class CodexAdapter implements AgentAdapter {
  readonly provider = 'codex' as const
  constructor(private readonly opts: CodexOptions = {}) {}

  private get bin() {
    return this.opts.bin ?? 'codex'
  }
  private get sessionsDir() {
    return join(this.opts.codexHome ?? join(homedir(), '.codex'), 'sessions')
  }
  private env(extra: Record<string, string>): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...(this.opts.codexHome ? { CODEX_HOME: this.opts.codexHome } : {}),
      ...extra,
    }
  }

  async check() {
    try {
      let out = ''
      const r = await spawnStreaming(this.bin, ['--version'], {
        cwd: process.cwd(),
        onLine: (l) => (out += l),
      })
      return r.code === 0
        ? { ok: true, detail: out || 'codex is installed' }
        : { ok: false, detail: r.stderr.trim() || `codex --version exited ${r.code}` }
    } catch (e) {
      return { ok: false, detail: `Couldn't run "${this.bin}": ${(e as Error).message}` }
    }
  }

  async readCapacity() {
    const r = await readCodexRateLimits(this.sessionsDir)
    return r ? { fiveHour: r.fiveHour, weekly: r.weekly } : null
  }

  async run(
    input: AdapterInput,
    signal: AbortSignal,
    onEvent: (e: AdapterEvent) => void,
  ): Promise<AdapterOutcome> {
    const dir = await mkdtemp(join(tmpdir(), 'sg-codex-'))
    try {
      const schemaPath = join(dir, 'result.schema.json')
      await writeFile(schemaPath, JSON.stringify(schemaForRole(input.role)))
      const resume = input.sessionRef !== null
      // Codex has no separate system prompt, so the role rules lead the message.
      const stdin = `${input.systemPrompt}\n\n---\n\n${input.prompt}`

      let completed = false
      let failure: string | null = null
      let lastMessage: string | null = null

      const proc = await spawnStreaming(
        this.bin,
        buildCodexArgs(input, schemaPath, resume, input.model),
        {
          cwd: input.cwd,
          env: this.env(input.env),
          stdin,
          signal,
          onLine: (line) => {
            let e: Record<string, unknown>
            try {
              e = JSON.parse(line) as Record<string, unknown>
            } catch {
              return
            }
            if (e.type === 'thread.started' && typeof e.thread_id === 'string')
              onEvent({ type: 'session', sessionRef: e.thread_id })
            else if (e.type === 'turn.completed') completed = true
            else if (e.type === 'turn.failed' || e.type === 'error') {
              const msg =
                (e.error as { message?: string } | undefined)?.message ??
                (e.message as string | undefined)
              failure = msg ?? JSON.stringify(e).slice(0, 300)
            } else if (e.type === 'item.completed') {
              const item = e.item as { type?: string; text?: string; command?: string } | undefined
              if (item?.type === 'agent_message' && item.text) {
                lastMessage = item.text
                onEvent({ type: 'progress', message: item.text.trim().slice(0, 300) })
              } else if (item?.type === 'command_execution' && item.command)
                onEvent({
                  type: 'log',
                  message: item.command.replace(/^\/bin\/\w+ -lc /, '').slice(0, 160),
                })
            }
          },
        },
      )

      if (proc.aborted) return { kind: 'interrupted', reason: 'The run was stopped.' }
      const limits = await readCodexRateLimits(this.sessionsDir).catch(() => null)
      if (limits) onEvent({ type: 'capacity', fiveHour: limits.fiveHour, weekly: limits.weekly })
      if (failure !== null) {
        if (limits?.reachedType || LIMIT_TEXT.test(failure)) return capacityOutcome(limits, failure)
        return { kind: 'failed', reason: failure }
      }
      if (!completed)
        return {
          kind: 'interrupted',
          reason: `Codex ended without finishing its turn (exit ${proc.code}).${proc.stderr.trim() ? ` ${proc.stderr.trim().slice(0, 300)}` : ''}`,
        }
      let value: unknown = null
      try {
        value = JSON.parse(lastMessage ?? '')
      } catch {
        /* not JSON: outcomeFromStructured reports it */
      }
      return outcomeFromStructured(input.role, value, null)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}

function capacityOutcome(limits: CodexRateLimits | null, message: string): AdapterOutcome {
  const window =
    limits?.reachedType?.toLowerCase().includes('week') || (limits?.weekly?.percent ?? 0) >= 100
      ? 'weekly'
      : limits?.fiveHour
        ? 'fiveHour'
        : null
  const resetsAt = window === 'weekly' ? limits?.weekly?.resetsAt : limits?.fiveHour?.resetsAt
  return { kind: 'capacity', resetsAt: resetsAt ?? null, window, message: message.slice(0, 300) }
}
