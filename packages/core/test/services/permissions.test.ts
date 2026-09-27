import { describe, expect, it } from 'vitest'

import type { Database } from '../../src/db/client'
import { getActivity, getBoard } from '../../src/services/board.service'
import { applyChanges } from '../../src/services/changes.service'
import type { Actor, ServiceContext } from '../../src/services/context'
import { exportCsv } from '../../src/services/export.service'
import { createItems, deleteItem, moveItem, renameItem } from '../../src/services/items.service'
import { addMember, listMembers } from '../../src/services/members.service'
import { getProject, setProjectArchived, updateProject } from '../../src/services/projects.service'
import { createStage, listStages } from '../../src/services/stages.service'
import { useTestDatabase } from '../helpers/db'
import { addMember as seedMember, createUser, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()

type Who = 'admin' | 'owner' | 'editor' | 'viewer' | 'outsider'
type Expect = 'ok' | 'forbidden' | 'not_found'

// Spec 04 §3. Each action runs against a fresh project.
const actions: [
  string,
  (ctx: ServiceContext, projectId: string, extra: { userId: string }) => Promise<unknown>,
  Record<Who, Expect>,
][] = [
  [
    'view board',
    (c, p) => getBoard(c, p),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'ok', outsider: 'not_found' },
  ],
  [
    'view project',
    (c, p) => getProject(c, p),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'ok', outsider: 'not_found' },
  ],
  [
    'list stages',
    (c, p) => listStages(c, p),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'ok', outsider: 'not_found' },
  ],
  [
    'list members',
    (c, p) => listMembers(c, p),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'ok', outsider: 'not_found' },
  ],
  [
    'activity',
    (c, p) => getActivity(c, p),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'ok', outsider: 'not_found' },
  ],
  [
    'export',
    (c, p) => exportCsv(c, p),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'ok', outsider: 'not_found' },
  ],
  [
    'change status',
    (c, p) =>
      applyChanges(c, p, {
        dryRun: false,
        changes: [{ item: 'Login', stage: 'QA', status: 'done' }],
      }),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'forbidden', outsider: 'not_found' },
  ],
  [
    'create items',
    (c, p) => createItems(c, p, { items: [{ name: 'New' }] }),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'forbidden', outsider: 'not_found' },
  ],
  [
    'rename item',
    (c, p) => renameItem(c, p, 'Login', 'Sign in'),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'forbidden', outsider: 'not_found' },
  ],
  [
    'move item',
    (c, p) => moveItem(c, p, 'Login', { parent: null }),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'forbidden', outsider: 'not_found' },
  ],
  [
    'delete item',
    (c, p) => deleteItem(c, p, 'Login'),
    { admin: 'ok', owner: 'ok', editor: 'ok', viewer: 'forbidden', outsider: 'not_found' },
  ],
  [
    'update project',
    (c, p) => updateProject(c, p, { name: 'X' }),
    { admin: 'ok', owner: 'ok', editor: 'forbidden', viewer: 'forbidden', outsider: 'not_found' },
  ],
  [
    'archive project',
    (c, p) => setProjectArchived(c, p, true),
    { admin: 'ok', owner: 'ok', editor: 'forbidden', viewer: 'forbidden', outsider: 'not_found' },
  ],
  [
    'create stage',
    (c, p) => createStage(c, p, { name: 'UAT' }),
    { admin: 'ok', owner: 'ok', editor: 'forbidden', viewer: 'forbidden', outsider: 'not_found' },
  ],
  [
    'add member',
    (c, p, extra) => addMember(c, p, { userId: extra.userId, role: 'viewer' }),
    { admin: 'ok', owner: 'ok', editor: 'forbidden', viewer: 'forbidden', outsider: 'not_found' },
  ],
]

async function world(db: Database) {
  const admin = await createUser(db, { isAdmin: true })
  const project = await seedProject(db, admin, { tree: [{ name: 'Login' }] })
  const actors: Record<Who, Actor> = {
    admin: await createUser(db, { isAdmin: true }),
    owner: await createUser(db),
    editor: await createUser(db),
    viewer: await createUser(db),
    outsider: await createUser(db),
  }
  await seedMember(db, project.id, actors.owner.userId, 'owner')
  await seedMember(db, project.id, actors.editor.userId, 'editor')
  await seedMember(db, project.id, actors.viewer.userId, 'viewer')
  const spare = await createUser(db)
  return { project, actors, spare }
}

describe('permission matrix', () => {
  for (const [name, run, expected] of actions) {
    for (const who of Object.keys(expected) as Who[]) {
      it(`${name} as ${who} → ${expected[who]}`, async () => {
        const db = getDb()
        const { project, actors, spare } = await world(db)
        const p = run(makeCtx(db, actors[who]), project.id, { userId: spare.userId })
        if (expected[who] === 'ok') await p
        else await expect(p).rejects.toMatchObject({ code: expected[who] })
      })
    }
  }
})
