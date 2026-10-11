import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A throwaway executable (Node script) standing in for a provider CLI. */
export async function fakeCli(name: string, body: string): Promise<{ bin: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'sg-fake-'))
  const bin = join(dir, name)
  await writeFile(bin, `#!${process.execPath}\n${body}\n`)
  await chmod(bin, 0o755)
  return { bin, dir }
}

export const jsonl = (...events: unknown[]): string =>
  events.map((e) => `process.stdout.write(${JSON.stringify(`${JSON.stringify(e)}\n`)})`).join('\n')
