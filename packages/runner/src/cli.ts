#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { buildAdapters } from './adapters'
import { ClaudeAdapter } from './adapters/claude'
import { CodexAdapter } from './adapters/codex'
import { RunnerApi, RunnerApiError } from './api'
import { configSchema, defaultConfigPath, loadConfig, saveConfig } from './config'
import { RunnerLoop } from './loop'
import { git } from './workspace'

const VERSION = '0.0.0'

const HELP = `stagegrid-runner ${VERSION}
Runs Stagegrid AI employees' work on this machine.

Usage:
  stagegrid-runner enroll --url <stagegrid url> --token <enrollment token>
  stagegrid-runner repo <project slug> <path to clone> [--base main]
  stagegrid-runner doctor
  stagegrid-runner start

Options:
  --config <file>   Runner config (default ~/.stagegrid-runner/config.json)
  -h, --help        Show this help

Get an enrollment token from Stagegrid (admin, Runners). The token works once; the runner keeps
its own credential in the config file, readable by you only.`

const out = (s: string) => process.stdout.write(`${s}\n`)

async function enroll(configPath: string, url: string, token: string): Promise<void> {
  const detected: string[] = []
  for (const a of [new ClaudeAdapter(), new CodexAdapter()])
    if ((await a.check()).ok) detected.push(a.provider)
  const { credential, runner } = await RunnerApi.enroll(url, {
    token,
    providers: detected,
    version: VERSION,
  })
  await saveConfig(
    configPath,
    configSchema.parse({
      url,
      credential,
      providers: Object.fromEntries(detected.map((p) => [p, {}])),
    }),
  )
  out(`Enrolled "${runner.name}". Config saved to ${configPath}.`)
  out(
    detected.length
      ? `Found: ${detected.join(', ')}.`
      : 'No claude or codex CLI found on PATH. Install one, then add it under "providers" in the config.',
  )
  out(
    'Next: stagegrid-runner repo <project slug> <path to the project clone>, then stagegrid-runner start.',
  )
}

async function addRepo(
  configPath: string,
  slug: string,
  path: string,
  base: string,
): Promise<void> {
  const config = await loadConfig(configPath)
  await git(['rev-parse', '--git-dir'], path).catch(() => {
    throw new Error(`${path} is not a git repository`)
  })
  config.repos[slug] = { path, baseBranch: base }
  await saveConfig(configPath, config)
  out(`Work for project "${slug}" will use ${path} (base branch ${base}).`)
}

async function doctor(configPath: string): Promise<boolean> {
  const config = await loadConfig(configPath)
  let ok = true
  const line = (good: boolean, text: string) => {
    ok &&= good
    out(`${good ? 'ok  ' : 'FAIL'} ${text}`)
  }
  line(
    await git(['--version'], process.cwd()).then(
      () => true,
      () => false,
    ),
    'git is installed',
  )
  for (const a of buildAdapters(config)) {
    const r = await a.check()
    line(r.ok, `${a.provider}: ${r.detail}`)
  }
  if (Object.keys(config.providers).length === 0) line(false, 'no provider is configured')
  try {
    await new RunnerApi(config.url, config.credential).queue(0)
    line(true, `Stagegrid at ${config.url} accepts this runner`)
  } catch (e) {
    line(false, `Stagegrid: ${(e as Error).message}`)
  }
  for (const [slug, repo] of Object.entries(config.repos))
    line(
      await access(repo.path).then(
        () => true,
        () => false,
      ),
      `project ${slug}: ${repo.path}`,
    )
  if (Object.keys(config.repos).length === 0) line(false, 'no project repository is configured')
  return ok
}

async function start(configPath: string): Promise<void> {
  const config = await loadConfig(configPath)
  const adapters = buildAdapters(config)
  if (adapters.length === 0)
    throw new Error('No provider is configured. Run "stagegrid-runner doctor".')
  const api = new RunnerApi(config.url, config.credential)
  await api.setSelf({ providers: adapters.map((a) => a.provider), version: VERSION })
  const loop = new RunnerLoop({
    api,
    config,
    adapters,
    log: (m) => out(`${new Date().toISOString()} ${m}`),
  })
  const controller = new AbortController()
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.on(sig, () => {
      out('Stopping: running work will be reported as interrupted.')
      controller.abort()
    })
  out(`Runner started for ${config.url} (${adapters.map((a) => a.provider).join(', ')}).`)
  await loop.start(controller.signal)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      url: { type: 'string' },
      token: { type: 'string' },
      base: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command, ...rest] = positionals
  const configPath = values.config ?? defaultConfigPath()
  if (values.help || !command) {
    out(HELP)
    return
  }
  switch (command) {
    case 'enroll':
      if (!values.url || !values.token) throw new Error('enroll needs --url and --token')
      return enroll(configPath, values.url, values.token)
    case 'repo':
      if (rest.length !== 2) throw new Error('usage: stagegrid-runner repo <project slug> <path>')
      return addRepo(configPath, rest[0]!, rest[1]!, values.base ?? 'main')
    case 'doctor': {
      if (!(await doctor(configPath))) process.exitCode = 1
      return
    }
    case 'start':
      return start(configPath)
    default:
      throw new Error(`Unknown command "${command}". Try --help.`)
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof RunnerApiError ? e.message : (e as Error).message}\n`)
  process.exit(1)
})
