import { defaultBaseDocx } from '@stagegrid/docs/docx'
import type { DocumentDto } from '@stagegrid/shared'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { APP_ORIGIN, browser, makeApp, SETUP_BODY } from '../helpers/app'
import { useTestDatabase } from '../helpers/db'
import { call, mcpClient } from '../helpers/mcp'

const getDb = useTestDatabase()

async function world() {
  const { app } = makeApp(getDb())
  const b = browser(app)
  await b.post('/api/v1/setup', SETUP_BODY)
  await b.post('/api/v1/projects', { name: 'Pilot' })
  await b.post('/api/v1/projects/pilot/items', { items: [{ name: 'Login' }, { name: 'Reports' }] })
  return { app, b }
}

describe('documents API', () => {
  it('saves a draft, edits it on the web, renders every format, and serves signed downloads', async () => {
    const { app, b } = await world()
    const created = (await (
      await b.post('/api/v1/projects/pilot/documents', {
        template: 'brd',
        draft: { sections: { '1': 'Summary text' } },
      })
    ).json()) as { documentId: string }
    const base = `/api/v1/projects/pilot/documents/${created.documentId}`
    expect(
      (await b.patch(base, { draft: { sections: { '1': 'Edited on the web' } } })).status,
    ).toBe(200)
    const doc = (await (await b.get(base)).json()) as DocumentDto
    expect(doc).toMatchObject({
      version: 2,
      template: { key: 'brd', kind: 'narrative' },
      draft: { sections: { '1': 'Edited on the web' } },
    })
    expect(doc.resolved.sections.find((s) => s.id.startsWith('6.1/'))).toMatchObject({
      number: '6.1',
      title: 'Login',
    })

    const docx = await b.get(`${base}/render?format=docx`)
    expect(docx.headers.get('content-disposition')).toMatch(
      /attachment; filename="pilot-brd-v2-\d{4}-\d{2}-\d{2}\.docx"/,
    )
    expect(
      strFromU8(unzipSync(new Uint8Array(await docx.arrayBuffer()))['word/document.xml']!),
    ).toContain('Edited on the web')
    const html = await b.get(`${base}/render?format=html`)
    expect(html.headers.get('content-disposition')).toMatch(/^inline/)
    expect(await html.text()).toContain('<h2>1 Executive summary</h2>')

    const { token } = (await (await b.post('/api/v1/me/tokens', { name: 'ai' })).json()) as {
      token: string
    }
    const client = await mcpClient(app, token)
    const { url } = await call<{ url: string }>(client, 'get_doc_download_url', {
      project: 'pilot',
      documentId: created.documentId,
      format: 'markdown',
    })
    expect(url.startsWith(`${APP_ORIGIN}/api/v1/documents/`)).toBe(true)
    const anon = await app.request(url.replace(APP_ORIGIN, ''))
    expect(anon.status).toBe(200)
    expect(await anon.text()).toContain('## 1 Executive summary\n\nEdited on the web')
    expect((await b.post(`${base}/revisions/1/restore`, {})).status).toBe(200)
  })

  it('manages templates with .docx uploads', async () => {
    const { app, b } = await world()
    const upload = (path: string, method: string, bytes: Uint8Array) => {
      const form = new FormData()
      form.append('file', new Blob([bytes as Uint8Array<ArrayBuffer>]), 'base.docx')
      return app.request(path, {
        method,
        body: form,
        headers: { cookie: b.cookie, origin: APP_ORIGIN },
      })
    }
    const imported = await upload(
      '/api/v1/admin/templates/import-sections',
      'POST',
      defaultBaseDocx(),
    )
    expect(await imported.json()).toEqual({ sections: [] })
    const created = await b.post('/api/v1/admin/templates', {
      key: 'spec',
      name: 'Screen spec',
      level: 'item',
      schema: {
        kind: 'narrative',
        sections: [{ id: '1', title: 'Purpose', level: 1, hint: 'Why' }],
      },
    })
    expect(created.status).toBe(201)
    expect(
      (await upload('/api/v1/admin/templates/spec/base-docx', 'PUT', defaultBaseDocx())).status,
    ).toBe(200)
    expect(
      (await b.get('/api/v1/admin/templates/spec/base-docx')).headers.get('content-type'),
    ).toContain('wordprocessingml')
    const tooBig = await upload(
      '/api/v1/admin/templates/spec/base-docx',
      'PUT',
      new Uint8Array(6 * 1024 * 1024),
    )
    expect(tooBig.status).toBe(413)
    const list = (await (await b.get('/api/v1/projects/pilot/doc-templates')).json()) as {
      key: string
    }[]
    expect(list.map((t) => t.key)).toContain('spec')
  })

  it('lets an AI write a document end to end over MCP', async () => {
    const { app, b } = await world()
    const { token } = (await (await b.post('/api/v1/me/tokens', { name: 'ai' })).json()) as {
      token: string
    }
    const client = await mcpClient(app, token)
    const templates = await call<{ key: string }[]>(client, 'list_doc_templates', {
      project: 'pilot',
    })
    expect(templates.map((t) => t.key)).toContain('srs')
    const t = await call<{ sections: { id: string; hint: string }[] }>(client, 'get_doc_template', {
      project: 'pilot',
      template: 'srs',
    })
    const feature = t.sections.find((s) => s.id.startsWith('3.1/'))!
    const saved = await call<{ documentId: string; viewUrl: string }>(client, 'save_doc_draft', {
      project: 'pilot',
      template: 'srs',
      item: 'Login',
      stage: 'Document',
      draft: { sections: { '1.1': 'Purpose here', [feature.id]: '1. FR-1 login' } },
    })
    expect(saved.viewUrl).toBe(`${APP_ORIGIN}/p/pilot/docs/${saved.documentId}`)
    const conf = await call<{ title: string; body: string }>(client, 'render_doc', {
      project: 'pilot',
      documentId: saved.documentId,
      format: 'confluence',
    })
    expect(conf.body).toContain('<h2>3.1 Login</h2>')
    const board = await call<{ rows: string[] }>(client, 'get_board', { project: 'pilot' })
    expect(board.rows[0]).toBe('Login | T T T T T T')
    const guide = await client.getPrompt({ name: 'write-document', arguments: { template: 'srs' } })
    expect(JSON.stringify(guide)).toContain('Write a srs with Stagegrid')
  })
})
