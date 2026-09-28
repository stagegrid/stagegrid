import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** `packages/core/skill` in development, `dist/skill` in the published package. */
function skillDir(): string {
  for (const rel of ['./skill', '../../skill']) {
    const dir = fileURLToPath(new URL(rel, import.meta.url))
    if (existsSync(`${dir}/stagegrid-guide.md`)) return dir
  }
  throw new Error('Stagegrid skill files not found')
}

let cache: { guide: string; sync: string; skill: string } | null = null

function files() {
  if (!cache) {
    const dir = skillDir()
    cache = {
      guide: readFileSync(`${dir}/stagegrid-guide.md`, 'utf8'),
      sync: readFileSync(`${dir}/sync-from-tracker.md`, 'utf8'),
      skill: readFileSync(`${dir}/SKILL.md`, 'utf8'),
    }
  }
  return cache
}

export const guideText = (): string => files().guide

export const syncText = (source: string): string => files().sync.replaceAll('{{source}}', source)

/** Claude skill (SKILL.md) with the instance URL and the shared guide inlined. */
export function skillMarkdown(appUrl: string): string {
  const f = files()
  return f.skill
    .replaceAll('{{APP_URL}}', appUrl)
    .replace('{{GUIDE}}', f.guide.replace(/^# .*\n/, ''))
    .replace(
      '{{SYNC}}',
      f.sync.replace(/^# .*\n/, '').replaceAll('{{source}}', 'the other tracker'),
    )
}
