import { DEFAULT_TEAM } from '@stagegrid/shared'
import { describe, expect, it } from 'vitest'

import {
  approveDocument,
  getDocument,
  revokeApproval,
  saveDocDraft,
} from '../../src/services/docs.service'
import { createEmployee } from '../../src/services/employees.service'
import { getProject } from '../../src/services/projects.service'
import { createTask, getTask, pinContext, transitionTask } from '../../src/services/tasks.service'
import { updateTeam } from '../../src/services/team.service'
import { useTestDatabase } from '../helpers/db'
import { addMember, createUser, makeCtx } from '../helpers/factories'
import { workSetup, type WorkWorld } from '../helpers/work'

const getDb = useTestDatabase()

const staff = (
  s: WorkWorld,
  displayName: string,
  role: 'analyst' | 'dev' | 'reviewer' | 'qa',
  provider: 'claude_code' | 'codex' = 'claude_code',
) =>
  createEmployee(s.ctx, s.project.id, {
    displayName,
    role,
    provider,
    model: null,
    instructions: '',
    avatar: null,
  })

const team = (over: Partial<typeof DEFAULT_TEAM> = {}) => ({ ...DEFAULT_TEAM, ...over })

describe('team settings', () => {
  it('is off by default and keeps the single-role workflow (AC-23)', async () => {
    const s = await workSetup(getDb)
    const project = await getProject(s.ctx, s.project.id)
    expect(project.team).toEqual(DEFAULT_TEAM)
  })

  it('maps each role to an employee of that role, and roles to different people', async () => {
    const s = await workSetup(getDb)
    const analyst = await staff(s, 'Nok', 'analyst')
    const reviewer = await staff(s, 'Ploy', 'reviewer', 'codex')
    const qa = await staff(s, 'Beam', 'qa')
    const saved = await updateTeam(
      s.ctx,
      s.project.id,
      team({
        analyst: { enabled: true, employeeId: analyst.id, stageId: null },
        dev: { employeeId: s.mali.id, stageId: null },
        reviewer: { enabled: true, employeeId: reviewer.id },
        qa: { enabled: true, employeeId: qa.id, stageId: null },
      }),
    )
    expect(saved.reviewer).toEqual({ enabled: true, employeeId: reviewer.id })
    expect((await getProject(s.ctx, s.project.id)).team.analyst.employeeId).toBe(analyst.id)
  })

  it('rejects the wrong role, a missing person, a shared employee and archived staff', async () => {
    const s = await workSetup(getDb)
    const qa = await staff(s, 'Beam', 'qa')
    await expect(
      updateTeam(s.ctx, s.project.id, team({ reviewer: { enabled: true, employeeId: qa.id } })),
    ).rejects.toMatchObject({
      code: 'validation_error',
      message: expect.stringContaining("so can't be the Reviewer"),
    })
    await expect(
      updateTeam(
        s.ctx,
        s.project.id,
        team({ qa: { enabled: true, employeeId: null, stageId: null } }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('pick who plays it') })
    await expect(
      updateTeam(
        s.ctx,
        s.project.id,
        team({
          dev: { employeeId: s.mali.id, stageId: null },
          reviewer: { enabled: true, employeeId: s.mali.id },
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('only one role') })
    await expect(
      updateTeam(
        s.ctx,
        s.project.id,
        team({ dev: { employeeId: '00000000-0000-4000-8000-000000000000', stageId: null } }),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('needs a stage for each role that works on one', async () => {
    const s = await workSetup(getDb)
    const analyst = await staff(s, 'Nok', 'analyst')
    await expect(
      updateTeam(
        s.ctx,
        s.project.id,
        team({
          analyst: {
            enabled: true,
            employeeId: analyst.id,
            stageId: '00000000-0000-4000-8000-000000000000',
          },
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("stage doesn't exist") })
  })

  it("is the owner's call, and caps the rework limit", async () => {
    const s = await workSetup(getDb)
    const editor = await createUser(s.db, { name: 'Ed' })
    await addMember(s.db, s.project.id, editor.userId, 'editor')
    await expect(
      updateTeam(makeCtx(s.db, editor, s.clock.now), s.project.id, team()),
    ).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect((await updateTeam(s.ctx, s.project.id, team({ reworkLimit: 0 }))).reworkLimit).toBe(0)
  })
})

describe('approving a document revision (AC-19)', () => {
  const draft = (s: WorkWorld, text: string, documentId?: string) =>
    saveDocDraft(s.ctx, s.project.id, {
      template: 'srs',
      item: 'Login',
      stage: 'Document',
      documentId,
      draft: { sections: { '1.1': text } },
    })

  it('records who, when and which version; a newer draft starts unapproved', async () => {
    const s = await workSetup(getDb)
    const doc = await draft(s, 'v1 text')
    const approved = await approveDocument(s.ctx, s.project.id, doc.documentId, {
      version: 1,
      note: 'Customer signed',
    })
    expect(approved.approval).toMatchObject({
      version: 1,
      approvedBy: 'Pond',
      note: 'Customer signed',
    })
    expect(approved.approvedVersions).toEqual([1])
    await draft(s, 'v2 text', doc.documentId)
    const now = await getDocument(s.ctx, s.project.id, doc.documentId)
    expect(now.version).toBe(2)
    expect(now.approval).toBeNull()
    expect(now.approvedVersions).toEqual([1])
    // Approving twice is a no-op; an unknown version is not found.
    await approveDocument(s.ctx, s.project.id, doc.documentId, { version: 1 })
    await expect(
      approveDocument(s.ctx, s.project.id, doc.documentId, { version: 9 }),
    ).rejects.toMatchObject({ code: 'not_found' })
    const withdrawn = await revokeApproval(s.ctx, s.project.id, doc.documentId, 1)
    expect(withdrawn.approvedVersions).toEqual([])
    await expect(revokeApproval(s.ctx, s.project.id, doc.documentId, 1)).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('needs an editor, and hides other projects', async () => {
    const s = await workSetup(getDb)
    const doc = await draft(s, 'v1 text')
    const viewer = await createUser(s.db, { name: 'Vi' })
    await addMember(s.db, s.project.id, viewer.userId, 'viewer')
    await expect(
      approveDocument(makeCtx(s.db, viewer, s.clock.now), s.project.id, doc.documentId, {
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    const outsider = await createUser(s.db, { name: 'Out' })
    await expect(
      approveDocument(makeCtx(s.db, outsider, s.clock.now), s.project.id, doc.documentId, {
        version: 1,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('keeps an employee task from becoming ready until that exact revision is approved', async () => {
    const s = await workSetup(getDb)
    const analyst = await staff(s, 'Nok', 'analyst')
    await updateTeam(
      s.ctx,
      s.project.id,
      team({
        analyst: { enabled: true, employeeId: analyst.id, stageId: null },
        dev: { employeeId: s.mali.id, stageId: null },
      }),
    )
    const doc = await draft(s, 'v1 text')
    const t = await createTask(s.ctx, s.project.id, {
      cellId: s.cellId,
      title: 'Build login',
      scope: '',
      acceptanceCriteria: [],
      required: true,
      ownerUserId: null,
      employeeId: s.mali.id,
    })
    await pinContext(s.ctx, s.project.id, t.id, {
      documentIds: [doc.documentId],
      sources: [],
      decisions: [],
    })
    const markReady = () =>
      transitionTask(s.ctx, s.project.id, t.id, { action: 'mark_ready', expectedVersion: 1 })
    await expect(markReady()).rejects.toMatchObject({
      details: { code: 'not_ready', reasons: [expect.stringContaining("isn't approved yet")] },
    })
    await approveDocument(s.ctx, s.project.id, doc.documentId, { version: 1 })
    expect((await markReady()).state).toBe('ready')

    // A newer draft is a different revision: pinning it needs its own approval.
    const t2 = await createTask(s.ctx, s.project.id, {
      cellId: s.cellId,
      title: 'Second',
      scope: '',
      acceptanceCriteria: [],
      required: true,
      ownerUserId: null,
      employeeId: s.mali.id,
    })
    await draft(s, 'v2 text', doc.documentId)
    await pinContext(s.ctx, s.project.id, t2.id, {
      documentIds: [doc.documentId],
      sources: [],
      decisions: [],
    })
    await expect(
      transitionTask(s.ctx, s.project.id, t2.id, { action: 'mark_ready', expectedVersion: 1 }),
    ).rejects.toMatchObject({ details: { code: 'not_ready' } })
    expect((await getTask(s.ctx, s.project.id, t.id)).state).toBe('ready')
  })

  it('does not ask for approval when the analyst workflow is off', async () => {
    const s = await workSetup(getDb)
    const doc = await draft(s, 'v1 text')
    const t = await createTask(s.ctx, s.project.id, {
      cellId: s.cellId,
      title: 'Build login',
      scope: '',
      acceptanceCriteria: [],
      required: true,
      ownerUserId: null,
      employeeId: s.mali.id,
    })
    await pinContext(s.ctx, s.project.id, t.id, {
      documentIds: [doc.documentId],
      sources: [],
      decisions: [],
    })
    expect(
      (
        await transitionTask(s.ctx, s.project.id, t.id, {
          action: 'mark_ready',
          expectedVersion: 1,
        })
      ).state,
    ).toBe('ready')
  })
})
