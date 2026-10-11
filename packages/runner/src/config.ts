import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { z } from 'zod'

const providerConfig = z.object({
  /** The CLI to run; defaults to `claude` / `codex` on PATH. */
  bin: z.string().optional(),
  model: z.string().optional(),
  /** Hard cap per run, where the CLI supports one (Claude Code). */
  maxBudgetUsd: z.number().positive().optional(),
})

const repoConfig = z.object({
  /** An existing clone of the project's repository on this machine. */
  path: z.string().min(1),
  baseBranch: z.string().min(1).default('main'),
})

export const configSchema = z.object({
  url: z.url(),
  credential: z.string().min(1),
  /** Project slug -> repository on this machine. A run for a project without one fails clearly. */
  repos: z.record(z.string(), repoConfig).default({}),
  worktreesDir: z.string().default(join(homedir(), '.stagegrid-runner', 'worktrees')),
  providers: z
    .object({ claude_code: providerConfig.optional(), codex: providerConfig.optional() })
    .default({}),
  /** Where Codex keeps its login and sessions; set a separate one to keep it from reading yours. */
  codexHome: z.string().optional(),
  pollWaitSeconds: z.number().int().min(0).max(25).default(20),
  heartbeatSeconds: z.number().int().min(5).default(30),
})

export type RunnerConfig = z.infer<typeof configSchema>

export const defaultConfigPath = (): string => join(homedir(), '.stagegrid-runner', 'config.json')

export async function loadConfig(path: string): Promise<RunnerConfig> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new Error(`No runner config at ${path}. Run "stagegrid-runner enroll" first.`)
  }
  const parsed = configSchema.safeParse(JSON.parse(text))
  if (!parsed.success)
    throw new Error(`Invalid runner config ${path}: ${z.prettifyError(parsed.error)}`)
  return parsed.data
}

/** The credential is a secret, so the file is readable by its owner only. */
export async function saveConfig(path: string, config: RunnerConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}
