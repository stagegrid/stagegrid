import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'
import { captureEvents } from '../helpers/listen'
import { call, mcpClient } from '../helpers/mcp'

const getDb = useTestDatabase()

async function world() {
  const { app } = makeApp(getDb())
  const admin = browser(app)
  await admin.post('/api/v1/setup', SETUP_BODY)
  await admin.post('/api/v1/projects', { name: 'Clinic OS' })
  await admin.post('/api/v1/projects/clinic-os/items', {
    items: [{ name: 'Login' }, { name: 'Settings', children: [{ name: 'Users' }] }],
  })
  const res = await admin.post('/api/v1/me/tokens', { name: 'claude' })
  const { token } = (await res.json()) as { token: string }
  return { app, admin, token, client: await mcpClient(app, token) }
}

describe('MCP endpoint', () => {
  it('requires a valid bearer token and a matching Origin', async () => {
    const { app, token } = await world()
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    expect((await app.request('/mcp', { method: 'POST', headers, body })).status).toBe(401)
    const bad = await app.request('/mcp', {
      method: 'POST',
      headers: { ...headers, authorization: 'Bearer sg_pat_nope' },
      body,
    })
    expect(bad.status).toBe(401)
    const evil = await app.request('/mcp', {
      method: 'POST',
      headers: { ...headers, authorization: `Bearer ${token}`, origin: 'https://evil.example' },
      body,
    })
    expect(evil.status).toBe(403)
  })

  it('lists the tools, prompts, and the guide resource', async () => {
    const { client } = await world()
    const tools = (await client.listTools()).tools
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_release_items',
      'apply_changes',
      'create_items',
      'create_project',
      'create_release',
      'delete_item',
      'edit_event',
      'get_board',
      'get_cell',
      'get_doc_download_url',
      'get_doc_template',
      'get_document',
      'get_recent_changes',
      'get_release',
      'get_summary',
      'list_doc_templates',
      'list_documents',
      'list_projects',
      'list_releases',
      'list_stale_cells',
      'manage_stages',
      'mark_release_released',
      'move_item',
      'remove_release_items',
      'render_doc',
      'save_doc_draft',
      'update_item',
      'update_release',
    ])
    expect(tools.find((t) => t.name === 'get_board')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === 'delete_item')?.annotations?.destructiveHint).toBe(true)
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort()
    expect(prompts).toEqual(['stagegrid-guide', 'sync-from-tracker', 'write-document'])
    const sync = await client.getPrompt({
      name: 'sync-from-tracker',
      arguments: { source: 'Jira project ABC' },
    })
    expect(JSON.stringify(sync)).toContain('Sync Stagegrid from Jira project ABC')
    const guide = await client.readResource({ uri: 'stagegrid://guide' })
    expect(JSON.stringify(guide)).toContain('propose, confirm, then apply')
  })

  it('reads the board in compact form', async () => {
    const { client } = await world()
    expect(await call(client, 'list_projects', {})).toEqual([
      expect.objectContaining({ slug: 'clinic-os', role: 'owner', percent: 0 }),
    ])
    const board = await call<{ rows: string[]; stages: string[] }>(client, 'get_board', {
      project: 'clinic-os',
    })
    expect(board.stages).toEqual(['Design', 'Document', 'Database', 'Implement', 'QA', 'Deploy'])
    expect(board.rows).toEqual([
      'Login | T T T T T T',
      'Settings | T T T T T T',
      'Settings > Users | T T T T T T',
    ])
    const branch = await call<{ rows: string[] }>(client, 'get_board', {
      project: 'clinic-os',
      path: 'settings',
    })
    expect(branch.rows).toHaveLength(2)
  })

  it('previews with dryRun, then applies, recording via "mcp" and notifying the board', async () => {
    const { client, admin } = await world()
    const changes = [
      {
        item: 'Settings > Users',
        stage: 'QA',
        status: 'done',
        happenedAt: '2026-10-03T10:00:00+07:00',
      },
    ]
    const preview = await call<{ dryRun: boolean; applied: number }>(client, 'apply_changes', {
      project: 'clinic-os',
      changes,
      dryRun: true,
    })
    expect(preview).toMatchObject({ dryRun: true, applied: 1 })
    const before = await call<{ rows: string[] }>(client, 'get_board', { project: 'clinic-os' })
    expect(before.rows[2]).toBe('Settings > Users | T T T T T T')

    const events = await captureEvents(() =>
      call(client, 'apply_changes', { project: 'clinic-os', changes }),
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'cell.updated',
        itemPath: 'Settings > Users',
        actor: expect.objectContaining({ via: 'mcp' }),
      }),
    ])
    const cell = await call<{ events: { actor: { via: string }; happenedAt: string }[] }>(
      client,
      'get_cell',
      {
        project: 'clinic-os',
        item: 'Settings > Users',
        stage: 'qa',
      },
    )
    expect(cell.events[0]).toMatchObject({
      actor: { via: 'mcp' },
      happenedAt: '2026-10-03T03:00:00.000Z',
    })
    const activity = (await (await admin.get('/api/v1/projects/clinic-os/activity')).json()) as {
      action: string
      actor: { via: string }
    }[]
    expect(activity[0]).toMatchObject({ action: 'cell.status', actor: { via: 'mcp' } })
  })

  it('returns actionable errors', async () => {
    const { client, admin } = await world()
    await admin.post('/api/v1/projects/clinic-os/items', {
      parent: 'Settings',
      items: [{ name: 'users' }],
    })
    await expect(
      call(client, 'get_cell', { project: 'clinic-os', item: 'Settings > Users', stage: 'QA' }),
    ).rejects.toThrow(/ambiguous_ref: .*Settings > Users.*\nCall again with the full path/s)
    await expect(
      call(client, 'apply_changes', {
        project: 'clinic-os',
        changes: [
          { item: 'Nope', stage: 'QA', status: 'done' },
          { item: 'Login', stage: 'Nope', status: 'done' },
        ],
      }),
    ).rejects.toThrow(
      /validation_error: 2 of 2 changes are invalid\n- change 0: item "Nope" not found.*\n- change 1: stage "Nope" not found/s,
    )
  })

  it('builds trees and manages stages', async () => {
    const { client } = await world()
    await call(client, 'create_items', {
      project: 'clinic-os',
      parent: 'Settings',
      items: [{ name: 'Master data', children: [{ name: 'Vehicles' }, { name: 'Holidays' }] }],
    })
    await call(client, 'move_item', {
      project: 'clinic-os',
      item: 'Settings > Master data > Holidays',
      before: 'Settings > Master data > Vehicles',
    })
    await call(client, 'manage_stages', {
      project: 'clinic-os',
      ops: [
        { op: 'add', name: 'SIT', after: 'QA' },
        { op: 'archive', stage: 'Document' },
      ],
    })
    const board = await call<{ rows: string[]; stages: string[] }>(client, 'get_board', {
      project: 'clinic-os',
      path: 'Settings > Master data',
    })
    expect(board.stages).toEqual(['Design', 'Database', 'Implement', 'QA', 'SIT', 'Deploy'])
    expect(board.rows.map((r) => r.split(' | ')[0])).toEqual([
      'Settings > Master data',
      'Settings > Master data > Holidays',
      'Settings > Master data > Vehicles',
    ])
    await call(client, 'delete_item', { project: 'clinic-os', item: 'Settings > Master data' })
    expect(
      (await call<{ rows: string[] }>(client, 'get_board', { project: 'clinic-os' })).rows,
    ).toHaveLength(3)
  })

  it("respects the token owner's role", async () => {
    const { app, admin } = await world()
    const invited = await admin.post('/api/v1/admin/users', {
      name: 'Vee',
      email: 'vee@example.com',
    })
    const inv = (await invited.json()) as { user: { id: string }; link: string }
    await admin.post('/api/v1/projects/clinic-os/members', { userId: inv.user.id, role: 'viewer' })
    const vee = browser(app)
    await vee.post('/api/v1/auth/accept', {
      token: new URL(inv.link).searchParams.get('token'),
      password: 'vee password 1',
    })
    const { token } = (await (await vee.post('/api/v1/me/tokens', { name: 'ai' })).json()) as {
      token: string
    }
    const client = await mcpClient(app, token)
    await expect(call(client, 'get_summary', { project: 'clinic-os' })).resolves.toBeTruthy()
    await expect(
      call(client, 'apply_changes', {
        project: 'clinic-os',
        changes: [{ item: 'Login', stage: 'QA', status: 'done' }],
      }),
    ).rejects.toThrow(/^forbidden:/)
    await expect(call(client, 'create_project', { name: 'Mine' })).rejects.toThrow(/^forbidden:/)
  })
})

describe('skill download', () => {
  it('zips a Claude skill with the instance URL and a plain guide', async () => {
    const { admin, app } = await world()
    expect((await app.request('/api/v1/skill.zip')).status).toBe(401)
    const res = await admin.get('/api/v1/skill.zip')
    expect(res.headers.get('content-type')).toBe('application/zip')
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    expect(Object.keys(files).sort()).toEqual(['stagegrid-guide.md', 'stagegrid/SKILL.md'])
    const skill = strFromU8(files['stagegrid/SKILL.md']!)
    expect(skill).toMatch(/^---\nname: stagegrid\ndescription: .*http:\/\/localhost:4000/)
    expect(skill).toContain('`http://localhost:4000/mcp`')
    expect(skill).toContain('propose, confirm, then apply')
    expect(skill).not.toContain('{{')
  })
})

describe('MCP cell details', () => {
  it('sets details through apply_changes and fixes history with edit_event', async () => {
    const { client } = await world()
    const res = await call<{ results: { details: string[] }[] }>(client, 'apply_changes', {
      project: 'clinic-os',
      changes: [
        {
          item: 'Login',
          stage: 'QA',
          status: 'done',
          happenedAt: '2026-10-05T00:00:00Z',
          assignees: [{ name: 'Somchai (Jira)' }],
          plannedEnd: '2026-10-04',
          link: { title: 'PROJ-9', url: 'https://jira.example.com/browse/PROJ-9', kind: 'issue' },
        },
      ],
    })
    expect(res.results[0]!.details).toEqual(['assignees', 'planned', 'link'])
    const cell = await call<{
      events: { id: string }[]
      assignees: { name: string }[]
      links: { title: string }[]
    }>(client, 'get_cell', {
      project: 'clinic-os',
      item: 'Login',
      stage: 'QA',
    })
    expect(cell.assignees.map((a) => a.name)).toEqual(['Somchai (Jira)'])
    expect(cell.links.map((l) => l.title)).toEqual(['PROJ-9'])
    await call(client, 'edit_event', {
      project: 'clinic-os',
      eventId: cell.events[0]!.id,
      delete: true,
    })
    const after = await call<{ status: string }>(client, 'get_cell', {
      project: 'clinic-os',
      item: 'Login',
      stage: 'QA',
    })
    expect(after.status).toBe('todo')
  })
})
