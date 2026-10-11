import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

import type { ClaimedRunDto } from '@stagegrid/shared'

import type { RunnerConfig } from './config'
import { git, type Worktree } from './workspace'

const run = promisify(execFile)

export interface SubmissionPayload {
  artifacts: {
    kind: 'pull_request' | 'branch' | 'commit'
    url: string | null
    repo: string | null
    branch: string | null
    headCommit: string
  }[]
  verification: {
    command: string
    exitCode: number
    commit: string
    source: 'agent_reported' | 'runner_reported' | 'ci_checked'
    output: string | null
  }[]
}

export type DeliveryOutcome =
  { ok: true; submission: SubmissionPayload } | { ok: false; reason: string }

type RepoConfig = RunnerConfig['repos'][string]

const tail = (s: string, n = 2000): string => (s.length > n ? `…${s.slice(-n)}` : s)

/** Runs a shell command in the worktree with a time limit; resolves with its exit code and output tail. */
export function runCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    // Its own process group, so a timeout stops the shell and everything it started, not just the shell.
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const collect = (c: Buffer) => {
      out += c.toString()
      if (out.length > 20_000) out = out.slice(-20_000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, timeoutSeconds * 1000)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? (signal ? 124 : 1),
        output: tail(signal ? `${out}\n(stopped after ${timeoutSeconds}s)` : out),
      })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ exitCode: 127, output: e.message })
    })
  })
}

/** owner/name from a GitHub remote URL (https or ssh), or null. */
export function repoFromRemote(url: string): string | null {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

/**
 * Turns "the agent says it is done" into something a person can check. The runner looks at the
 * worktree itself (is there a commit, is everything committed), runs the project's test command
 * and reports its exit code, and only then pushes or opens a pull request, if the project allows it.
 * What the agent claimed about tests is kept, but labelled as the agent's own word.
 */
export async function buildDelivery(opts: {
  claim: ClaimedRunDto
  worktree: Worktree
  repo: RepoConfig
  config: Pick<RunnerConfig, 'ghBin'>
  agent: { summary: string; commit: string | null; tests: string | null }
}): Promise<DeliveryOutcome> {
  const { claim, worktree, repo, agent } = opts
  const cwd = worktree.path
  const head = (await git(['rev-parse', 'HEAD'], cwd).catch(() => '')).trim()
  if (!head) return { ok: false, reason: "Couldn't read the commit the agent worked on." }
  if (head === worktree.baseCommit)
    return { ok: false, reason: 'The agent reported success but made no commit.' }
  const dirty = (
    await git(['status', '--porcelain', '--untracked-files=no'], cwd).catch(() => '')
  ).trim()
  if (dirty)
    return {
      ok: false,
      reason: `The agent left uncommitted changes, so the commit isn't the whole result:\n${tail(dirty, 500)}`,
    }
  if (agent.commit) {
    const known = await git(['rev-parse', '--verify', `${agent.commit}^{commit}`], cwd).then(
      () => true,
      () => false,
    )
    if (!known)
      return { ok: false, reason: `The agent named a commit that doesn't exist: ${agent.commit}.` }
  }

  const verification: SubmissionPayload['verification'] = []
  if (repo.testCommand) {
    const r = await runCommand(repo.testCommand, cwd, repo.testTimeoutSeconds)
    verification.push({
      command: repo.testCommand,
      exitCode: r.exitCode,
      commit: head,
      source: 'runner_reported',
      output: r.output || null,
    })
  }
  if (agent.tests)
    verification.push({
      command: `The agent reported: ${agent.tests}`.slice(0, 500),
      exitCode: 0,
      commit: head,
      source: 'agent_reported',
      output: null,
    })

  const mode = claim.delivery.mode
  const branch = worktree.branch
  if (mode === 'local')
    return {
      ok: true,
      submission: {
        artifacts: [{ kind: 'commit', url: null, repo: null, branch, headCommit: head }],
        verification,
      },
    }

  // Pushing and pull requests only happen because the project allows them.
  const remoteUrl = await git(['remote', 'get-url', repo.remote], cwd).catch(() => '')
  const slug = claim.delivery.repo ?? repoFromRemote(remoteUrl)
  if (!slug)
    return {
      ok: false,
      reason: `Can't tell which GitHub repository ${repo.remote} points to. Set it in the project's delivery settings.`,
    }
  try {
    await git(['push', '--set-upstream', repo.remote, `${branch}:${branch}`], cwd)
  } catch (e) {
    return { ok: false, reason: `Couldn't push ${branch}: ${(e as Error).message.split('\n')[0]}` }
  }
  if (mode === 'branch')
    return {
      ok: true,
      submission: {
        artifacts: [{ kind: 'branch', url: null, repo: slug, branch, headCommit: head }],
        verification,
      },
    }

  let url: string | null
  try {
    const existing = await run(
      opts.config.ghBin,
      [
        'pr',
        'list',
        '--repo',
        slug,
        '--head',
        branch,
        '--state',
        'open',
        '--json',
        'url',
        '--limit',
        '1',
      ],
      { cwd },
    )
    url = (JSON.parse(existing.stdout || '[]') as { url: string }[])[0]?.url ?? null
    if (!url) {
      const created = await run(
        opts.config.ghBin,
        [
          'pr',
          'create',
          '--repo',
          slug,
          '--head',
          branch,
          '--base',
          repo.baseBranch,
          '--title',
          claim.task.title,
          '--body',
          [agent.summary, `Task: ${claim.task.title}`, `Commit: ${head}`].join('\n\n'),
        ],
        { cwd },
      )
      url = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.stdout)?.[0] ?? null
    }
  } catch (e) {
    return {
      ok: false,
      reason: `Couldn't open the pull request: ${(e as Error).message.split('\n')[0]}`,
    }
  }
  if (!url)
    return { ok: false, reason: "The pull request was created but its URL couldn't be read." }
  return {
    ok: true,
    submission: {
      artifacts: [{ kind: 'pull_request', url, repo: slug, branch, headCommit: head }],
      verification,
    },
  }
}

/**
 * Leaves the review on the pull request as a comment, when the project works with pull requests. It is
 * only ever a comment: a Reviewer never approves, requests changes on GitHub, or merges.
 */
export async function postReviewComment(opts: {
  claim: ClaimedRunDto
  report: {
    verdict: string
    summary: string
    findings: { severity: string; text: string; file: string | null }[]
  }
  config: Pick<RunnerConfig, 'ghBin'>
}): Promise<void> {
  const pr = opts.claim.examine?.artifacts.find((a) => a.kind === 'pull_request' && a.url)
  if (!pr?.url || opts.claim.delivery.mode !== 'pull_request') return
  const lines = opts.report.findings.map(
    (f) => `- **${f.severity}** ${f.text}${f.file ? ` (\`${f.file}\`)` : ''}`,
  )
  const body = [
    `Review of ${opts.claim.examine!.headCommit.slice(0, 7)}: ${opts.report.verdict === 'pass' ? 'no changes needed' : 'changes requested'}`,
    opts.report.summary,
    ...lines,
  ]
    .filter(Boolean)
    .join('\n\n')
  await run(opts.config.ghBin, ['pr', 'comment', pr.url, '--body', body])
}
