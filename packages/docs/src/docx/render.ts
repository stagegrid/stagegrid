import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import type { DocModel } from '../model'
import { defaultBaseDocx } from './base'
import { blockXml, type BodyContext, fieldsXml, headingXml, xmlEscape } from './xml'

const NUMBERING_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
const NUMBERING_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'
const LINK_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
const BULLET_ABS = 9001
const DECIMAL_ABS = 9002

/** styleId for Word's built-in "heading N" in this document, if it defines one. */
function headingStyles(stylesXml: string): (level: 1 | 2 | 3) => string | null {
  const map = new Map<string, string>()
  for (const m of stylesXml.matchAll(
    /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g,
  )) {
    const name = /<w:name w:val="([^"]+)"/.exec(m[2]!)?.[1]?.toLowerCase()
    if (name) map.set(name, m[1]!)
  }
  return (level) => map.get(`heading ${level}`) ?? null
}

function abstractNum(id: number, ordered: boolean): string {
  const lvl = (i: number) =>
    `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : i === 0 ? '•' : '◦'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
  return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${lvl(0)}${lvl(1)}</w:abstractNum>`
}

function replacePlaceholders(xml: string, values: Record<string, string>): string {
  // Merge adjacent runs' text first would need full parsing; placeholders must sit in one run (spec 06 §5.1).
  return xml.replace(/\{\{(title|project|version|date|author)\}\}/g, (_, k: string) =>
    xmlEscape(values[k] ?? ''),
  )
}

/**
 * Renders a document into a copy of `base` (the template's base .docx, or the default): replaces
 * placeholders everywhere and puts the body where `{{content}}` is (or at the end of the body).
 */
export function renderDocx(doc: DocModel, base: Uint8Array = defaultBaseDocx()): Uint8Array {
  const files = unzipSync(base)
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : null)
  const documentXml = read('word/document.xml')
  if (!documentXml) throw new Error('The base document has no word/document.xml')
  let rels =
    read('word/_rels/document.xml.rels') ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  let contentTypes = read('[Content_Types].xml')!
  let numbering = read('word/numbering.xml')

  const relIds = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]!))
  let relSeq = 0
  const newRelId = () => {
    let id: string
    do id = `rIdSg${++relSeq}`
    while (relIds.has(id))
    relIds.add(id)
    return id
  }
  const linkRels: string[] = []
  const nums: string[] = []
  let numSeq = 9100
  const ctx: BodyContext = {
    headingStyle: headingStyles(read('word/styles.xml') ?? ''),
    link(url) {
      const id = newRelId()
      linkRels.push(
        `<Relationship Id="${id}" Type="${LINK_REL}" Target="${xmlEscape(url)}" TargetMode="External"/>`,
      )
      return id
    },
    listNum(ordered) {
      const id = ++numSeq
      nums.push(
        `<w:num w:numId="${id}"><w:abstractNumId w:val="${ordered ? DECIMAL_ABS : BULLET_ABS}"/>${ordered ? '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>' : ''}</w:num>`,
      )
      return id
    },
  }

  const body = doc.blocks
    .map((b) =>
      b.type === 'heading'
        ? headingXml(b.level, b.text, ctx)
        : b.type === 'fields'
          ? fieldsXml(b.rows, ctx)
          : blockXml(b, ctx),
    )
    .join('')

  const values = {
    title: doc.meta.title,
    project: doc.meta.project,
    version: String(doc.meta.version),
    date: doc.meta.date,
    author: doc.meta.author,
  }
  let out = replacePlaceholders(documentXml, values)
  const marker = out.indexOf('{{content}}')
  if (marker >= 0) {
    const start = Math.max(out.lastIndexOf('<w:p>', marker), out.lastIndexOf('<w:p ', marker))
    const end = out.indexOf('</w:p>', marker) + '</w:p>'.length
    out = out.slice(0, start) + body + out.slice(end)
  } else {
    const sect = out.lastIndexOf('<w:sectPr')
    const at = sect >= 0 ? sect : out.lastIndexOf('</w:body>')
    out = out.slice(0, at) + body + out.slice(at)
  }
  files['word/document.xml'] = strToU8(out)
  for (const name of Object.keys(files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name))
      files[name] = strToU8(replacePlaceholders(strFromU8(files[name]!), values))
  }

  if (nums.length) {
    const ours = abstractNum(BULLET_ABS, false) + abstractNum(DECIMAL_ABS, true)
    if (!numbering) {
      numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${ours}${nums.join('')}</w:numbering>`
      rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="${newRelId()}" Type="${NUMBERING_REL}" Target="numbering.xml"/></Relationships>`,
      )
      contentTypes = contentTypes.replace(
        '</Types>',
        `<Override PartName="/word/numbering.xml" ContentType="${NUMBERING_TYPE}"/></Types>`,
      )
    } else {
      // abstractNum elements must come before num elements.
      const firstNum = numbering.search(/<w:num\b/)
      numbering =
        firstNum >= 0
          ? numbering.slice(0, firstNum) + ours + numbering.slice(firstNum)
          : numbering.replace('</w:numbering>', ours + '</w:numbering>')
      numbering = numbering.replace('</w:numbering>', `${nums.join('')}</w:numbering>`)
    }
    files['word/numbering.xml'] = strToU8(numbering)
  }
  if (linkRels.length)
    rels = rels.replace('</Relationships>', `${linkRels.join('')}</Relationships>`)
  files['word/_rels/document.xml.rels'] = strToU8(rels)
  files['[Content_Types].xml'] = strToU8(contentTypes)
  return zipSync(files)
}
