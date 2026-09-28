import { describe, expect, it } from 'vitest'

import { parseContent, plainText } from '../content'
import { buildDocModel } from '../model'
import { resolveTemplate } from '../resolve'
import { templateSchema } from '../schema'
import { renderConfluence, renderHtml } from './html'
import { renderMarkdown } from './markdown'

const meta = {
  title: 'SRS – Clinic OS',
  project: 'Clinic OS',
  version: 2,
  date: '2026-10-20',
  author: 'Pond',
}

describe('parseContent', () => {
  it('keeps the supported subset and drops unsafe links and headings', () => {
    const b = parseContent(
      '# Big\n\nHello **bold** *it* `x` [site](https://a.example) [bad](javascript:alert(1))\n\n- a\n  - b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<b>raw</b>',
    )
    expect(b[0]).toEqual({ type: 'p', inlines: [{ type: 'text', value: 'Big', bold: true }] })
    expect(b[1]).toMatchObject({ type: 'p' })
    expect(JSON.stringify(b[1])).toContain('"url":"https://a.example"')
    expect(JSON.stringify(b[1])).not.toContain('javascript')
    expect(b[2]).toMatchObject({
      type: 'list',
      ordered: false,
      items: [[{ type: 'p' }, { type: 'list' }]],
    })
    expect(b[3]).toMatchObject({ type: 'table', header: [[{ value: 'A' }], [{ value: 'B' }]] })
    // Raw HTML is kept as literal text, never as markup.
    const raw = b[4]!
    expect(raw.type === 'p' && plainText(raw.inlines)).toBe('<b>raw</b>')
  })
})

describe('renderers', () => {
  const t = resolveTemplate(
    templateSchema.parse({
      kind: 'form',
      fields: [
        { id: 'date', label: 'Date', type: 'date' },
        { id: 'who', label: 'Attendees', type: 'list' },
      ],
      sections: [
        { id: '1', title: 'Summary', level: 1 },
        { id: '1.1', title: 'Details', level: 2 },
      ],
    }),
    { items: [] },
  )
  const doc = buildDocModel(
    t,
    {
      fields: { date: '2026-10-20', who: ['Pond', 'Bee'] },
      sections: { '1': 'All <good> & **done**' },
    },
    meta,
  )

  it('renders HTML with escaping, numbered headings, and empty sections as a dash', () => {
    const html = renderHtml(doc)
    expect(html).toContain('<h1>SRS – Clinic OS</h1>')
    expect(html).toContain('<h2>1 Summary</h2>')
    expect(html).toContain('<h3>1.1 Details</h3>\n<p>—</p>')
    expect(html).toContain('All &lt;good&gt; &amp; <strong>done</strong>')
    expect(html).toContain(
      '<tr><th>Attendees</th><td><ul><li><p>Pond</p></li><li><p>Bee</p></li></ul></td></tr>',
    )
  })

  it('renders Confluence storage XHTML without the title', () => {
    const c = renderConfluence(doc)
    expect(c.title).toBe('SRS – Clinic OS')
    expect(c.body).not.toContain('<h1>SRS')
    expect(c.body).toContain('<h1>1 Summary</h1>')
  })

  it('renders Markdown', () => {
    const md = renderMarkdown(doc)
    expect(md).toContain('# SRS – Clinic OS\n\nClinic OS · v2 · 2026-10-20 · Pond')
    expect(md).toContain('| **Attendees** | - Pond<br>- Bee |')
    expect(md).toContain('## 1 Summary\n\nAll <good> & **done**')
    expect(md).toContain('### 1.1 Details\n\n—')
  })
})
