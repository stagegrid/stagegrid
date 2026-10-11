import { spawn } from 'node:child_process'

export interface SpawnResult {
  code: number | null
  signal: NodeJS.Signals | null
  stderr: string
  /** True when we stopped it because the signal fired. */
  aborted: boolean
}

/**
 * Runs a CLI and hands each stdout line to `onLine`. On abort it asks the process to stop (SIGINT,
 * which both agent CLIs treat as "cancel") and only kills it if it ignores that.
 */
export function spawnStreaming(
  command: string,
  args: string[],
  opts: {
    cwd: string
    env?: NodeJS.ProcessEnv
    stdin?: string
    signal?: AbortSignal
    graceMs?: number
    onLine: (line: string) => void
  },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    let buffer = ''
    let aborted = false
    let killTimer: NodeJS.Timeout | undefined

    const stop = () => {
      aborted = true
      child.kill('SIGINT')
      killTimer = setTimeout(() => child.kill('SIGKILL'), opts.graceMs ?? 5000)
    }
    if (opts.signal?.aborted) stop()
    else opts.signal?.addEventListener('abort', stop, { once: true })

    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line) opts.onLine(line)
      }
    })
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (c: string) => {
      if (stderr.length < 20_000) stderr += c
    })
    if (opts.stdin !== undefined) {
      child.stdin!.on('error', () => {})
      child.stdin!.end(opts.stdin)
    }
    child.on('error', (err) => {
      clearTimeout(killTimer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      clearTimeout(killTimer)
      if (buffer.trim()) opts.onLine(buffer.trim())
      resolve({ code, signal, stderr, aborted })
    })
  })
}
