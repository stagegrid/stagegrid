import { defaultBaseDocx, renderDocx } from '@stagegrid/docs/docx'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { getCellByRefs } from '../../src/services/board.service'
import {
  createTemplate,
  deleteDocument,
  getDocument,
  importSections,
  listDocuments,
  listTemplates,
  projectTemplates,
  renderDocument,
  renderSigned,
  resolveTemplateFor,
  restoreRevision,
  saveDocDraft,
  setBaseDocx,
  setProjectTemplates,
  signedDownloadUrl,
  updateTemplate,
} from '../../src/services/docs.service'
import { addReleaseItems, createRelease } from '../../src/services/releases.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, createUser, FIXED_NOW, makeCtx, seedProject } from '../helpers/factories'

const getDb = useTestDatabase()

async function setup() {
  const db = getDb()
  const admin = await createUser(db, { isAdmin: true, name: 'Pond' })
  const project = await seedProject(db, admin, {
    name: 'Clinic OS',
    tree: [{ name: 'Login' }, { name: 'Settings', children: [{ name: 'Users' }] }],
  })
  return { db, admin, project, ctx: makeCtx(db, admin) }
}

describe('templates', () => {
  it('seeds the seven built-ins and protects their sections', async () => {
    const { ctx } = await setup()
    const list = await listTemplates(ctx)
    expect(list.map((t) => t.key)).toEqual(
      expect.arrayContaining([
        'brd',
        'srs',
        'mom',
        'release-notes',
        'change-request',
        'uat-signoff',
        'test-summary',
      ]),
    )
    await expect(
      updateTemplate(ctx, 'srs', {
        schema: { kind: 'narrative', sections: [{ id: '1', title: 'x', level: 1 }] },
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect((await updateTemplate(ctx, 'srs', { name: 'SRS (ISO 29110)' })).name).toBe(
      'SRS (ISO 29110)',
    )
  })

  it('creates custom templates, validates their schema, and imports sections from .docx', async () => {
    const { ctx } = await setup()
    await expect(
      createTemplate(ctx, {
        key: 'spec',
        name: 'Screen spec',
        level: 'item',
        schema: { kind: 'narrative', sections: [] },
      }),
    ).rejects.toMatchObject({ code: 'validation_error' })
    const t = await createTemplate(ctx, {
      key: 'spec',
      name: 'Screen spec',
      level: 'item',
      schema: {
        kind: 'narrative',
        sections: [{ id: '1', title: 'Purpose', level: 1, hint: 'Why' }],
      },
    })
    expect(t).toMatchObject({ key: 'spec', level: 'item', builtin: false, sectionCount: 1 })
    const docx = renderDocx(
      {
        meta: { title: 't', project: 'p', version: 1, date: '2026-10-20', author: 'a' },
        blocks: [
          { type: 'heading', level: 1, text: '1 Overview' },
          { type: 'heading', level: 2, text: 'Goals' },
        ],
      },
      defaultBaseDocx(),
    )
    expect(importSections(ctx, docx)).toEqual([
      { id: '1', title: 'Overview', level: 1, hint: '' },
      { id: '1.1', title: 'Goals', level: 2, hint: '' },
    ])
    await expect(
      setBaseDocx(ctx, 'spec', new TextEncoder().encode('not a zip')),
    ).rejects.toMatchObject({ code: 'validation_error' })
    expect((await setBaseDocx(ctx, 'spec', defaultBaseDocx())).hasBaseDocx).toBe(true)
  })

  it('limits a project to its selected templates', async () => {
    const { ctx, project } = await setup()
    const all = await projectTemplates(ctx, project.id)
    expect(all.length).toBeGreaterThanOrEqual(7)
    await setProjectTemplates(ctx, project.id, [all.find((t) => t.key === 'brd')!.id])
    expect((await projectTemplates(ctx, project.id)).map((t) => t.key)).toEqual(['brd'])
    const everything = await projectTemplates(ctx, project.id, { all: true })
    expect(everything.length).toBe(all.length)
    expect(everything.filter((t) => t.selected).map((t) => t.key)).toEqual(['brd'])
    await expect(
      saveDocDraft(ctx, project.id, { template: 'srs', draft: {} }),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('documents', () => {
  it('resolves repeat sections, saves versions, links the cell, and renders every format', async () => {
    const { ctx, project } = await setup()
    const srs = await resolveTemplateFor(ctx, project.id, 'srs')
    const features = srs.sections.filter((s) => s.id.startsWith('3.1/'))
    expect(features.map((s) => [s.number, s.title])).toEqual([
      ['3.1', 'Login'],
      ['3.2', 'Settings'],
      ['3.3', 'Users'],
    ])
    await expect(
      saveDocDraft(ctx, project.id, { template: 'srs', draft: { sections: { nope: 'x' } } }),
    ).rejects.toMatchObject({
      code: 'validation_error',
      message: expect.stringContaining('Unknown section "nope"'),
    })
    const first = await saveDocDraft(ctx, project.id, {
      template: 'srs',
      item: 'Login',
      stage: 'Document',
      draft: {
        sections: {
          '1.1': 'ระบบจัดการคลินิก',
          [features[0]!.id]: '- FR-1 Sign in with email\n- FR-2 OTP',
        },
      },
    })
    expect(first).toMatchObject({
      version: 1,
      viewUrl: `http://localhost:4000/p/clinic-os/docs/${first.documentId}`,
    })
    const cell = await getCellByRefs(ctx, project.id, 'Login', 'Document')
    expect(cell.links).toEqual([
      expect.objectContaining({
        kind: 'doc',
        title: 'Software Requirements Specification (SRS) – Login',
      }),
    ])

    const second = await saveDocDraft(ctx, project.id, {
      template: 'srs',
      documentId: first.documentId,
      title: 'SRS v2',
      draft: { sections: { '1.1': 'Updated' } },
    })
    expect(second.version).toBe(2)
    expect((await getCellByRefs(ctx, project.id, 'Login', 'Document')).links).toEqual([
      expect.objectContaining({ title: 'SRS v2' }),
    ])
    const doc = await getDocument(ctx, project.id, first.documentId)
    expect(doc).toMatchObject({
      title: 'SRS v2',
      version: 2,
      item: { path: 'Login' },
      stage: { name: 'Document' },
      revisions: [{ version: 2 }, { version: 1 }],
    })
    expect((await getDocument(ctx, project.id, first.documentId, 1)).draft.sections?.['1.1']).toBe(
      'ระบบจัดการคลินิก',
    )
    await restoreRevision(ctx, project.id, first.documentId, 1)
    expect((await getDocument(ctx, project.id, first.documentId)).version).toBe(3)

    const md = await renderDocument(ctx, project.id, first.documentId, 'md')
    expect(md.filename).toBe('clinic-os-srs-v3-2026-10-20.md')
    expect(md.body).toContain('### 1.1 Purpose\n\nระบบจัดการคลินิก')
    expect(md.body).toContain('### 3.1 Login\n\n- FR-1 Sign in with email')
    const conf = await renderDocument(ctx, project.id, first.documentId, 'confluence')
    expect(conf.body).toContain('<h2>1.1 Purpose</h2>')
    const docx = await renderDocument(ctx, project.id, first.documentId, 'docx')
    expect(strFromU8(unzipSync(docx.body as Uint8Array)['word/document.xml']!)).toContain(
      'ระบบจัดการคลินิก',
    )
    expect((await listDocuments(ctx, project.id, { template: 'srs' })).map((d) => d.id)).toEqual([
      first.documentId,
    ])

    await deleteDocument(ctx, project.id, first.documentId)
    expect(await listDocuments(ctx, project.id)).toEqual([])
    expect((await getCellByRefs(ctx, project.id, 'Login', 'Document')).links).toEqual([])
  })

  it('release-level documents list the release scope', async () => {
    const { ctx, project } = await setup()
    await createRelease(ctx, project.id, { name: 'v1', targetDate: '2026-11-25', description: '' })
    await addReleaseItems(ctx, project.id, 'v1', {
      dryRun: false,
      items: [
        { item: 'Settings > Users', kind: 'new' },
        { item: 'Login', kind: 'change', stages: ['QA'] },
      ],
    })
    await expect(resolveTemplateFor(ctx, project.id, 'release-notes')).rejects.toMatchObject({
      code: 'validation_error',
    })
    const t = await resolveTemplateFor(ctx, project.id, 'release-notes', { release: 'v1' })
    expect(t.sections.filter((s) => s.id.includes('/')).map((s) => [s.number, s.title])).toEqual([
      ['2.1', 'Users'],
      ['3.1', 'Login'],
    ])
    const saved = await saveDocDraft(ctx, project.id, {
      template: 'release-notes',
      release: 'v1',
      draft: { sections: { '1': 'Big release' } },
    })
    expect((await getDocument(ctx, project.id, saved.documentId)).release).toMatchObject({
      name: 'v1',
    })
  })

  it('signed download links work without a session and expire', async () => {
    const { db, ctx, project } = await setup()
    const saved = await saveDocDraft(ctx, project.id, {
      template: 'mom',
      draft: { fields: { title: 'Kickoff', attendees: ['Pond'] } },
    })
    const { url } = await signedDownloadUrl(ctx, project.id, saved.documentId, 'md')
    const q = Object.fromEntries(new URL(url).searchParams.entries())
    const anon = { db: db.db, now: () => FIXED_NOW, config: ctx.config }
    expect((await renderSigned(anon, saved.documentId, q)).body).toContain(
      '| **Meeting** | Kickoff |',
    )
    await expect(renderSigned(anon, saved.documentId, { ...q, sig: 'x' })).rejects.toMatchObject({
      code: 'forbidden',
    })
    const later = { ...anon, now: () => new Date(FIXED_NOW.getTime() + 16 * 60_000) }
    await expect(renderSigned(later, saved.documentId, q)).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringContaining('expired'),
    })
  })

  it('viewers read, editors write', async () => {
    const { db, ctx, project } = await setup()
    const viewer = await createUser(db)
    await addMember(db, project.id, viewer.userId, 'viewer')
    const saved = await saveDocDraft(ctx, project.id, { template: 'brd', draft: {} })
    const v = makeCtx(db, viewer)
    await expect(getDocument(v, project.id, saved.documentId)).resolves.toBeTruthy()
    await expect(saveDocDraft(v, project.id, { template: 'brd', draft: {} })).rejects.toMatchObject(
      { code: 'forbidden' },
    )
    await expect(listTemplates(v)).rejects.toMatchObject({ code: 'forbidden' })
  })
})
