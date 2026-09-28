import { templateSchema } from '../schema'
import brd from './brd.json' with { type: 'json' }
import changeRequest from './change-request.json' with { type: 'json' }
import mom from './mom.json' with { type: 'json' }
import releaseNotes from './release-notes.json' with { type: 'json' }
import srs from './srs.json' with { type: 'json' }
import testSummary from './test-summary.json' with { type: 'json' }
import uatSignoff from './uat-signoff.json' with { type: 'json' }

export type TemplateLevel = 'project' | 'item' | 'release'

export interface BuiltinTemplate {
  key: string
  name: string
  level: TemplateLevel
  schema: ReturnType<typeof templateSchema.parse>
}

/** The seven templates shipped with Stagegrid (spec 06 §4). Validated on load. */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  brd,
  srs,
  mom,
  releaseNotes,
  changeRequest,
  uatSignoff,
  testSummary,
].map((t) => ({
  key: t.key,
  name: t.name,
  level: t.level as TemplateLevel,
  schema: templateSchema.parse(t.schema),
}))
