import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { branchFor, ensureWorktree, git, headCommit } from '../src/workspace'

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'sg-repo-'))
  const run = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  run('init', '-b', 'main')
  run('config', 'user.email', 't@example.com')
  run('config', 'user.name', 'T')
  await writeFile(join(dir, 'README.md'), 'hello\n')
  run('add', '.')
  run('commit', '-m', 'init')
  return { dir, run }
}

const taskId = '0192f3c4-aaaa-7bbb-8ccc-ddddeeeeffff'

describe('ensureWorktree', () => {
  it('makes an isolated branch and worktree and leaves the main checkout alone', async () => {
    const { dir } = await repo()
    const worktreesDir = await mkdtemp(join(tmpdir(), 'sg-wt-'))
    const w = await ensureWorktree({
      repoPath: dir,
      worktreesDir,
      projectSlug: 'pilot',
      taskId,
      baseBranch: 'main',
    })
    expect(w).toMatchObject({ branch: branchFor(taskId), created: true })
    expect(existsSync(join(w.path, 'README.md'))).toBe(true)
    expect(await git(['branch', '--show-current'], w.path)).toBe(branchFor(taskId))
    expect(await git(['branch', '--show-current'], dir)).toBe('main')
    expect(await headCommit(w.path)).toBe(w.baseCommit)
  })

  it('reuses the worktree of an earlier attempt, keeping its work', async () => {
    const { dir } = await repo()
    const worktreesDir = await mkdtemp(join(tmpdir(), 'sg-wt-'))
    const opts = { repoPath: dir, worktreesDir, projectSlug: 'pilot', taskId, baseBranch: 'main' }
    const first = await ensureWorktree(opts)
    await writeFile(join(first.path, 'work.txt'), 'in progress\n')
    const again = await ensureWorktree(opts)
    expect(again).toMatchObject({ path: first.path, created: false })
    expect(await readFile(join(again.path, 'work.txt'), 'utf8')).toBe('in progress\n')
  })

  it('recreates the worktree on the existing branch if only the folder is gone', async () => {
    const { dir, run } = await repo()
    const worktreesDir = await mkdtemp(join(tmpdir(), 'sg-wt-'))
    run('branch', branchFor(taskId))
    const w = await ensureWorktree({
      repoPath: dir,
      worktreesDir,
      projectSlug: 'pilot',
      taskId,
      baseBranch: 'main',
    })
    expect(await git(['branch', '--show-current'], w.path)).toBe(branchFor(taskId))
  })

  it('says clearly when the repository or branch is missing', async () => {
    const { dir } = await repo()
    const worktreesDir = await mkdtemp(join(tmpdir(), 'sg-wt-'))
    await expect(
      ensureWorktree({
        repoPath: join(dir, 'nope'),
        worktreesDir,
        projectSlug: 'p',
        taskId,
        baseBranch: 'main',
      }),
    ).rejects.toThrow(/isn't at/)
    await expect(
      ensureWorktree({
        repoPath: dir,
        worktreesDir,
        projectSlug: 'p',
        taskId,
        baseBranch: 'develop',
      }),
    ).rejects.toThrow(/"develop" doesn't exist/)
  })
})
