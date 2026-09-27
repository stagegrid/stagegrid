import { strToU8, zipSync } from 'fflate'
import { Hono } from 'hono'

import { guideText, skillMarkdown } from '../../mcp/skill'
import { requireAuth } from '../context'
import type { AppEnv } from '../env'

/** Downloadable AI instructions: a Claude skill folder plus a plain guide for other assistants. */
export const skillRoutes = new Hono<AppEnv>().get('/skill.zip', (c) => {
  requireAuth(c)
  const { appUrl } = c.get('deps').config
  const zip = zipSync({
    'stagegrid/SKILL.md': strToU8(skillMarkdown(appUrl)),
    'stagegrid-guide.md': strToU8(
      guideText().replace(/^(# .*)$/m, `$1\n\nMCP server: ${appUrl}/mcp`),
    ),
  })
  return c.body(zip, 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="stagegrid-skill.zip"',
  })
})
