import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClaimedRunDto } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import { buildDelivery, repoFromRemote, runCommand } from '../src/delivery'
import { ensureWorktree } from '../src/workspace'
import { fakeCli } from './helpers'

const taskId = '0192f3c4-aaaa-7bbb-8ccc-ddddeeeeffff'

async function repoWithRemote() {
  const root = await mkdtemp(join(tmpdir(), 'sg-del-'))
  const bare = join(root, 'remote.git')
  const repo = join(root, 'clone')
  execFileSync('git', ['init', '--bare', '-b', 'main', bare])
  execFileSync('git', ['init', '-b', 'main', repo])
  const g = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
  g('config', 'user.email', 't@example.com')
  g('config', 'user.name', 'T')
  await writeFile(join(repo, 'a.txt'), 'a\n')
  g('add', '.')
  g('commit', '-m', 'init')
  g('remote', 'add', 'origin', bare)
  g('push', '-u', 'origin', 'main')
  const worktreesDir = join(root, 'wt')
  const worktree = await ensureWorktree({
    repoPath: repo,
    worktreesDir,
    projectSlug: 'pilot',
    taskId,
    baseBranch: 'main',
  })
  return { root, bare, repo, worktree }
}

function claim(mode: 'local' | 'branch' | 'pull_request', repo: string | null): ClaimedRunDto {
  return {
    run: {
      id: 'r',
      attempt: 1,
      fencingToken: 1,
      leaseExpiresAt: '',
      sessionRef: null,
      runtime: { provider: 'claude_code', model: null, instructions: '' },
    },
    project: { id: 'p', slug: 'pilot', name: 'Pilot' },
    employee: { id: 'e', displayName: 'Mali', role: 'dev' },
    task: { id: taskId, title: 'Email login', scope: '', acceptanceCriteria: [] },
    context: {} as ClaimedRunDto['context'],
    documents: [],
    delivery: { mode, repo },
    answers: [],
  }
}

const commit = (cwd: string) => {
  execFileSync('git', ['config', 'user.email', 'ai@example.com'], { cwd })
  execFileSync('git', ['config', 'user.name', 'AI'], { cwd })
  execFileSync('sh', ['-c', 'echo x > f.txt && git add -A && git commit -q -m "feat: x"'], { cwd })
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd }).toString().trim()
}

const repoCfg = (path: string, extra = {}) => ({
  path,
  baseBranch: 'main',
  testTimeoutSeconds: 30,
  remote: 'origin',
  ...extra,
})
const agent = { summary: 'Done', commit: null, tests: null }

describe('buildDelivery', () => {
  it('delivers a local commit with the runner-run check as evidence', async () => {
    const { repo, worktree } = await repoWithRemote()
    const head = commit(worktree.path)
    const r = await buildDelivery({
      claim: claim('local', null),
      worktree,
      repo: repoCfg(repo, { testCommand: 'exit 0' }),
      config: { ghBin: 'gh' },
      agent,
    })
    expect(r).toEqual({
      ok: true,
      submission: {
        artifacts: [
          { kind: 'commit', url: null, repo: null, branch: worktree.branch, headCommit: head },
        ],
        verification: [
          expect.objectContaining({
            command: 'exit 0',
            exitCode: 0,
            commit: head,
            source: 'runner_reported',
          }),
        ],
      },
    })
  })

  it('does not push anything in local mode', async () => {
    const { repo, bare, worktree } = await repoWithRemote()
    commit(worktree.path)
    await buildDelivery({
      claim: claim('local', null),
      worktree,
      repo: repoCfg(repo),
      config: { ghBin: 'gh' },
      agent,
    })
    expect(execFileSync('git', ['branch', '--list'], { cwd: bare }).toString()).not.toContain(
      'stagegrid/',
    )
  })

  it('pushes the branch when the project allows it', async () => {
    const { repo, bare, worktree } = await repoWithRemote()
    const head = commit(worktree.path)
    const r = await buildDelivery({
      claim: claim('branch', 'acme/clinic'),
      worktree,
      repo: repoCfg(repo),
      config: { ghBin: 'gh' },
      agent: { ...agent, tests: '3 passed' },
    })
    expect(r).toMatchObject({
      ok: true,
      submission: {
        artifacts: [
          { kind: 'branch', repo: 'acme/clinic', branch: worktree.branch, headCommit: head },
        ],
      },
    })
    expect(execFileSync('git', ['branch', '--list'], { cwd: bare }).toString()).toContain(
      worktree.branch,
    )
  })

  it('opens a pull request once and reuses it on a retry', async () => {
    const { repo, worktree, root } = await repoWithRemote()
    const head = commit(worktree.path)
    const log = join(root, 'gh.log')
    const { bin } = await fakeCli(
      'gh',
      `const fs = require('node:fs')
       const a = process.argv.slice(2)
       fs.appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n')
       if (a[1] === 'list') console.log(fs.existsSync(${JSON.stringify(`${log}.created`)}) ? JSON.stringify([{ url: 'https://github.com/acme/clinic/pull/7' }]) : '[]')
       else { fs.writeFileSync(${JSON.stringify(`${log}.created`)}, '1'); console.log('https://github.com/acme/clinic/pull/7') }`,
    )
    const run = () =>
      buildDelivery({
        claim: claim('pull_request', 'acme/clinic'),
        worktree,
        repo: repoCfg(repo),
        config: { ghBin: bin },
        agent,
      })
    const first = await run()
    const second = await run()
    for (const r of [first, second])
      expect(r).toMatchObject({
        ok: true,
        submission: {
          artifacts: [
            {
              kind: 'pull_request',
              url: 'https://github.com/acme/clinic/pull/7',
              headCommit: head,
            },
          ],
        },
      })
    const calls = (await readFile(log, 'utf8')).trim().split('\n')
    expect(calls.filter((c) => c.startsWith('pr create'))).toHaveLength(1)
    expect(calls[calls.length - 1]).toMatch(/^pr list/)
    expect(calls.find((c) => c.startsWith('pr create'))).toContain('--base main')
    expect(calls.join('\n')).not.toMatch(/--force|merge/)
  })

  it('fails with the reason when the push or the pull request cannot be made', async () => {
    const { repo, worktree } = await repoWithRemote()
    commit(worktree.path)
    execFileSync('git', ['remote', 'set-url', 'origin', '/nonexistent/remote.git'], { cwd: repo })
    const pushFail = await buildDelivery({
      claim: claim('branch', 'acme/clinic'),
      worktree,
      repo: repoCfg(repo),
      config: { ghBin: 'gh' },
      agent,
    })
    expect(pushFail).toMatchObject({ ok: false, reason: expect.stringContaining("Couldn't push") })

    const ok = await repoWithRemote()
    commit(ok.worktree.path)
    const { bin } = await fakeCli('gh', "console.error('not logged in'); process.exit(1)")
    const prFail = await buildDelivery({
      claim: claim('pull_request', 'acme/clinic'),
      worktree: ok.worktree,
      repo: repoCfg(ok.repo),
      config: { ghBin: bin },
      agent,
    })
    expect(prFail).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Couldn't open the pull request"),
    })
  })

  it('refuses to guess the repository', async () => {
    const { repo, worktree } = await repoWithRemote()
    commit(worktree.path)
    const r = await buildDelivery({
      claim: claim('branch', null),
      worktree,
      repo: repoCfg(repo),
      config: { ghBin: 'gh' },
      agent,
    })
    expect(r).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Can't tell which GitHub repository"),
    })
  })

  it('rejects a commit the agent named that does not exist', async () => {
    const { repo, worktree } = await repoWithRemote()
    commit(worktree.path)
    const r = await buildDelivery({
      claim: claim('local', null),
      worktree,
      repo: repoCfg(repo),
      config: { ghBin: 'gh' },
      agent: { ...agent, commit: 'deadbeefdeadbeef' },
    })
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("doesn't exist") })
  })
})

describe('helpers', () => {
  it('reads owner/name from GitHub remotes', () => {
    expect(repoFromRemote('https://github.com/acme/clinic.git')).toBe('acme/clinic')
    expect(repoFromRemote('git@github.com:acme/clinic.git')).toBe('acme/clinic')
    expect(repoFromRemote('/tmp/x.git')).toBeNull()
  })
  it('limits how long a command may run and reports its exit code', async () => {
    expect(await runCommand('echo hi && exit 2', process.cwd(), 5)).toMatchObject({
      exitCode: 2,
      output: expect.stringContaining('hi'),
    })
    const slow = await runCommand('sleep 5', process.cwd(), 1)
    expect(slow.exitCode).not.toBe(0)
    expect(slow.output).toContain('stopped after 1s')
  })
})
