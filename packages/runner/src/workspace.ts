import { execFile } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
  return stdout.trim()
}

export interface Worktree {
  path: string
  branch: string
  baseCommit: string
  /** False when a previous attempt's worktree was reused (rework, retry or resume). */
  created: boolean
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  )

/** One branch and one worktree per task, so a retry or rework continues where it left off. */
export const branchFor = (taskId: string): string => `stagegrid/task-${taskId.slice(0, 12)}`

/**
 * Prepares an isolated checkout for a task next to the project's clone. The person's own working
 * copy is never touched: no checkout, reset or stash happens there, and nothing is pushed.
 */
export async function ensureWorktree(opts: {
  repoPath: string
  worktreesDir: string
  projectSlug: string
  taskId: string
  baseBranch: string
}): Promise<Worktree> {
  const branch = branchFor(opts.taskId)
  const path = join(opts.worktreesDir, opts.projectSlug, branch.replace('/', '-'))
  if (!(await exists(opts.repoPath)))
    throw new Error(`The repository for this project isn't at ${opts.repoPath}`)
  const baseCommit = await git(
    ['rev-parse', '--verify', `${opts.baseBranch}^{commit}`],
    opts.repoPath,
  ).catch(() => {
    throw new Error(`Branch "${opts.baseBranch}" doesn't exist in ${opts.repoPath}`)
  })
  if (await exists(join(path, '.git'))) return { path, branch, baseCommit, created: false }

  await mkdir(join(opts.worktreesDir, opts.projectSlug), { recursive: true })
  const branchExists = await git(
    ['rev-parse', '--verify', `refs/heads/${branch}`],
    opts.repoPath,
  ).then(
    () => true,
    () => false,
  )
  await git(
    branchExists
      ? ['worktree', 'add', path, branch]
      : ['worktree', 'add', '-b', branch, path, baseCommit],
    opts.repoPath,
  )
  return { path, branch, baseCommit, created: true }
}

/** The commit the worktree is on, for reporting; null if it can't be read. */
export const headCommit = (path: string): Promise<string | null> =>
  git(['rev-parse', 'HEAD'], path).catch(() => null)
