import { randomUUID } from 'node:crypto'

import type { ClaimedRunDto, QueuedRunDto } from '@stagegrid/shared'

import type { AdapterEvent, AdapterOutcome, AgentAdapter } from './adapters/types'
import {
  type AskBody,
  type CapacityBody,
  type CompleteBody,
  type RunEventBody,
  RunnerApiError,
} from './api'
import type { RunnerConfig } from './config'
import { systemPrompt, taskPrompt } from './prompt'
import { ensureWorktree } from './workspace'

/** The part of the server API the loop uses; tests swap in a fake. */
export interface LoopApi {
  queue(waitSeconds: number, signal?: AbortSignal): Promise<QueuedRunDto[]>
  claim(runId: string, idempotencyKey: string): Promise<ClaimedRunDto>
  heartbeat(runId: string, fencingToken: number): Promise<{ leaseExpiresAt: string }>
  event(runId: string, body: RunEventBody): Promise<{ duplicate: boolean }>
  ask(runId: string, body: AskBody): Promise<unknown>
  complete(runId: string, body: CompleteBody): Promise<unknown>
  reportCapacity(input: CapacityBody): Promise<void>
}

export interface LoopOptions {
  api: LoopApi
  config: RunnerConfig
  adapters: AgentAdapter[]
  maxConcurrent?: number
  log?: (message: string) => void
  /** How often progress messages are forwarded; the newest one wins. */
  progressIntervalMs?: number
}

const RETRIES = 3
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Retries a call only when the network failed; the server's answers are final. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn()
    } catch (e) {
      if (!(e instanceof RunnerApiError && e.isNetwork) || attempt >= RETRIES) throw e
      await sleep(200 * attempt)
    }
  }
}

export class RunnerLoop {
  private readonly active = new Map<string, AbortController>()
  private readonly tasks = new Set<Promise<void>>()
  private readonly log: (m: string) => void
  private lastCapacityAt = 0

  constructor(private readonly opts: LoopOptions) {
    this.log = opts.log ?? (() => {})
  }

  get activeRuns(): number {
    return this.active.size
  }

  /** Polls until `signal` aborts, then stops running work and waits for it to report. */
  async start(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.tick(signal)
      } catch (e) {
        if (signal.aborted) break
        this.log(`poll failed: ${(e as Error).message}`)
        await sleep(5000)
      }
    }
    for (const c of this.active.values()) c.abort()
    await this.idle()
  }

  /** Resolves when every run in flight has finished reporting. */
  async idle(): Promise<void> {
    while (this.tasks.size) await Promise.allSettled([...this.tasks])
  }

  async tick(signal?: AbortSignal): Promise<void> {
    await this.reportCapacity()
    const max = this.opts.maxConcurrent ?? 1
    if (this.active.size >= max) {
      await sleep(1000)
      return
    }
    const queued = await this.opts.api.queue(this.opts.config.pollWaitSeconds, signal)
    for (const q of queued) {
      if (this.active.size >= max || signal?.aborted) break
      if (this.active.has(q.id)) continue
      if (!this.opts.adapters.some((a) => a.provider === q.provider)) continue
      const claimKey = `claim-${randomUUID()}`
      let claim: ClaimedRunDto
      try {
        claim = await withRetry(() => this.opts.api.claim(q.id, claimKey))
      } catch (e) {
        if (e instanceof RunnerApiError && e.status === 409) {
          this.log(`run ${q.id} not claimed: ${e.message}`)
          continue
        }
        throw e
      }
      this.log(`claimed run ${q.id}: ${q.taskTitle} (attempt ${q.attempt}, ${q.provider})`)
      const controller = new AbortController()
      this.active.set(q.id, controller)
      const task = this.execute(claim, controller)
        .catch((e) => this.log(`run ${q.id} crashed: ${(e as Error).message}`))
        .finally(() => {
          this.active.delete(q.id)
          this.tasks.delete(task)
        })
      this.tasks.add(task)
    }
  }

  private async reportCapacity(): Promise<void> {
    if (Date.now() - this.lastCapacityAt < 60_000) return
    this.lastCapacityAt = Date.now()
    for (const a of this.opts.adapters) {
      const reading = await a.readCapacity?.().catch(() => null)
      if (reading)
        await this.opts.api
          .reportCapacity({ provider: a.provider, ...reading })
          .catch((e) => this.log(`capacity report failed: ${(e as Error).message}`))
    }
  }

  private async execute(claim: ClaimedRunDto, controller: AbortController): Promise<void> {
    const { api, config } = this.opts
    const runId = claim.run.id
    const token = claim.run.fencingToken
    let leaseLost = false
    let sequence = 0

    const complete = (body: Omit<CompleteBody, 'fencingToken' | 'idempotencyKey'>) => {
      this.log(
        `run ${runId}: ${body.outcome}${body.failureReason ? ` (${body.failureReason})` : ''}`,
      )
      return withRetry(() =>
        api.complete(runId, {
          ...body,
          fencingToken: token,
          idempotencyKey: `${runId}:${token}:complete`,
        }),
      )
        .then(() => undefined)
        .catch((e: unknown) => {
          if (e instanceof RunnerApiError && e.isStaleLease) return
          throw e
        })
    }

    const send = async (type: RunEventBody['type'], payload: Record<string, unknown>) => {
      sequence += 1
      const eventId = `${runId}:${token}:${sequence}`
      try {
        await withRetry(() =>
          api.event(runId, { eventId, sequence, type, payload, fencingToken: token }),
        )
      } catch (e) {
        if (e instanceof RunnerApiError && e.isStaleLease) {
          leaseLost = true
          controller.abort()
          return
        }
        this.log(`event ${eventId} failed: ${(e as Error).message}`)
      }
    }

    const adapter = this.opts.adapters.find((a) => a.provider === claim.run.runtime.provider)
    const repo = config.repos[claim.project.slug]
    if (!adapter)
      return complete({
        outcome: 'failed',
        failureReason: `This runner has no ${claim.run.runtime.provider} adapter.`,
      })
    if (!repo)
      return complete({
        outcome: 'failed',
        failureReason: `This runner has no repository configured for project "${claim.project.slug}".`,
      })

    let worktree
    try {
      worktree = await ensureWorktree({
        repoPath: repo.path,
        worktreesDir: config.worktreesDir,
        projectSlug: claim.project.slug,
        taskId: claim.task.id,
        baseBranch: repo.baseBranch,
      })
    } catch (e) {
      return complete({ outcome: 'failed', failureReason: (e as Error).message })
    }

    const heartbeat = setInterval(() => {
      api.heartbeat(runId, token).catch((e) => {
        if (e instanceof RunnerApiError && e.isStaleLease) {
          leaseLost = true
          controller.abort()
        } else this.log(`heartbeat failed: ${(e as Error).message}`)
      })
    }, config.heartbeatSeconds * 1000)

    // Forward the newest progress message every few seconds instead of every line.
    let pending: string | null = null
    const interval = this.opts.progressIntervalMs ?? 3000
    const progressTimer = setInterval(() => {
      if (pending) {
        const message = pending
        pending = null
        void send('progress', { message })
      }
    }, interval)

    const onEvent = (e: AdapterEvent) => {
      if (e.type === 'session') void send('session', { sessionRef: e.sessionRef })
      else if (e.type === 'progress') pending = e.message
      else if (e.type === 'capacity')
        void api
          .reportCapacity({
            provider: claim.run.runtime.provider,
            fiveHour: e.fiveHour,
            weekly: e.weekly,
          })
          .catch(() => {})
    }

    let outcome: AdapterOutcome
    try {
      outcome = await adapter.run(
        {
          cwd: worktree.path,
          prompt: taskPrompt(claim, worktree.branch),
          systemPrompt: systemPrompt(claim.employee.displayName, claim.run.runtime.instructions),
          model: claim.run.runtime.model,
          sessionRef: claim.run.sessionRef,
          env: {
            GIT_AUTHOR_NAME: `${claim.employee.displayName} (AI)`,
            GIT_AUTHOR_EMAIL: 'ai-employee@stagegrid.invalid',
            GIT_COMMITTER_NAME: `${claim.employee.displayName} (AI)`,
            GIT_COMMITTER_EMAIL: 'ai-employee@stagegrid.invalid',
          },
          gitDir: `${repo.path}/.git`,
        },
        controller.signal,
        onEvent,
      )
    } catch (e) {
      outcome = { kind: 'failed', reason: (e as Error).message }
    } finally {
      clearInterval(heartbeat)
      clearInterval(progressTimer)
    }
    if (pending) await send('progress', { message: pending })
    if (leaseLost) {
      this.log(`run ${runId}: the server revoked this lease; stopped without reporting`)
      return
    }

    switch (outcome.kind) {
      case 'finished':
        if (outcome.blocked)
          return complete({ outcome: 'failed', failureReason: `Blocked: ${outcome.summary}` })
        return complete({
          outcome: 'succeeded',
          summary: [
            outcome.summary,
            outcome.commit ? `Commit: ${outcome.commit}` : null,
            outcome.tests ? `Tests: ${outcome.tests}` : null,
          ]
            .filter(Boolean)
            .join('\n\n'),
        })
      case 'needs_answers':
        // The run stops here: Stagegrid shows the questions and queues the run again once answered.
        return withRetry(() =>
          api.ask(runId, {
            questions: outcome.questions,
            contextRevisionId: claim.context.revisionId,
            idempotencyKey: `${runId}:${token}:ask`,
            fencingToken: token,
          }),
        )
          .then(() => undefined)
          .catch((e: unknown) => {
            if (e instanceof RunnerApiError && e.isStaleLease) return
            return complete({
              outcome: 'failed',
              failureReason: `Couldn't ask its questions: ${(e as Error).message}`,
            })
          })
      case 'capacity':
        await send('capacity_wait', {
          ...(outcome.resetsAt ? { resetsAt: outcome.resetsAt } : {}),
          ...(outcome.window ? { window: outcome.window } : {}),
          message: outcome.message,
        })
        return
      case 'interrupted':
        return complete({ outcome: 'interrupted', failureReason: outcome.reason })
      case 'failed':
        return complete({ outcome: 'failed', failureReason: outcome.reason })
    }
  }
}
