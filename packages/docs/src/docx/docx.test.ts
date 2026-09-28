import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { buildDocModel } from '../model'
import { resolveTemplate } from '../resolve'
import { templateSchema } from '../schema'
import { defaultBaseDocx } from './base'
import { DocxError, extractSections, readDocx } from './extract'
import { renderDocx } from './render'

const meta = {
  title: 'BRD <Clinic> & Co',
  project: 'Clinic OS',
  version: 3,
  date: '2026-10-20',
  author: 'Pond',
}
const t = resolveTemplate(
  templateSchema.parse({
    kind: 'narrative',
    sections: [
      { id: '1', title: 'Summary', level: 1 },
      { id: '1.1', title: 'Scope', level: 2 },
      { id: '2', title: 'Requirements', level: 1 },
    ],
  }),
  { items: [] },
)
const draft = {
  sections: {
    '1': 'สรุป **สำคัญ** see [spec](https://docs.example.com/spec)',
    '1.1': '1. first\n2. second\n\n- a\n- b',
    '2': '| A | B |\n|---|---|\n| 1 | 2 |',
  },
}

const docXml = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!)

describe('renderDocx', () => {
  it('fills placeholders (escaped) and replaces the {{content}} paragraph with the body', () => {
    const out = renderDocx(buildDocModel(t, draft, meta))
    const xml = docXml(out)
    expect(xml).toContain('BRD &lt;Clinic&gt; &amp; Co')
    expect(xml).toContain('Version 3 · 2026-10-20')
    expect(xml).not.toContain('{{')
    expect(xml).toContain(
      '<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">1 Summary</w:t>',
    )
    expect(xml).toContain('สรุป ')
    expect(xml).toMatch(/<w:hyperlink r:id="rIdSg\d+">/)
    expect(xml).toContain('<w:tbl>')
    const files = unzipSync(out)
    expect(strFromU8(files['word/_rels/document.xml.rels']!)).toContain(
      'Target="https://docs.example.com/spec" TargetMode="External"',
    )
    expect(strFromU8(files['word/numbering.xml']!)).toMatch(
      /<w:abstractNum w:abstractNumId="9001">[\s\S]*<w:num w:numId="9101">/,
    )
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('/word/numbering.xml')
  })

  it('appends the body before sectPr when the base has no marker, and falls back without heading styles', () => {
    const base = zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
      ),
      'word/document.xml': strToU8(
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Cover</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
      ),
    })
    const xml = docXml(renderDocx(buildDocModel(t, draft, meta), base))
    expect(xml.indexOf('Cover')).toBeLessThan(xml.indexOf('1 Summary'))
    expect(xml.indexOf('1 Summary')).toBeLessThan(xml.indexOf('<w:sectPr'))
    expect(xml).toContain('<w:b/><w:bCs/><w:sz w:val="32"/>')
  })
})

describe('extractSections', () => {
  it('reads heading 1–3 back as numbered sections', () => {
    const out = renderDocx(buildDocModel(t, draft, meta))
    expect(extractSections(out)).toEqual([
      { id: '1', title: 'Summary', level: 1, hint: '' },
      { id: '1.1', title: 'Scope', level: 2, hint: '' },
      { id: '2', title: 'Requirements', level: 1, hint: '' },
    ])
  })
  it('rejects non-docx and oversized files', () => {
    expect(() => readDocx(strToU8('hello'))).toThrow(DocxError)
    expect(() => readDocx(new Uint8Array(5 * 1024 * 1024 + 1))).toThrow('larger than 5 MB')
    expect(readDocx(defaultBaseDocx())['word/document.xml']).toBeDefined()
  })
})
