import { strFromU8, unzipSync } from 'fflate'

import type { TemplateSection } from '../schema'

const MAX_UPLOAD = 5 * 1024 * 1024
const MAX_UNZIPPED = 50 * 1024 * 1024

export class DocxError extends Error {}

/** Unzips a user-supplied .docx with size limits (zip-bomb guard, spec 05 §1). */
export function readDocx(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.byteLength > MAX_UPLOAD) throw new DocxError('The file is larger than 5 MB')
  let total = 0
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize
        if (total > MAX_UNZIPPED) throw new DocxError('The file expands to more than 50 MB')
        return true
      },
    })
  } catch (e) {
    if (e instanceof DocxError) throw e
    throw new DocxError("This isn't a .docx file")
  }
  if (!files['word/document.xml'])
    throw new DocxError("This isn't a .docx file (no word/document.xml)")
  return files
}

/**
 * Headings (Word styles "heading 1–3") of a .docx as template sections, numbered by position
 * ("1", "1.1", "1.1.1"). Body text is ignored (spec 06 §6 "Import sections").
 */
export function extractSections(bytes: Uint8Array): TemplateSection[] {
  const files = readDocx(bytes)
  const styles = files['word/styles.xml'] ? strFromU8(files['word/styles.xml']) : ''
  const levelOfStyle = new Map<string, 1 | 2 | 3>()
  for (const m of styles.matchAll(
    /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g,
  )) {
    const name = /<w:name w:val="([^"]+)"/.exec(m[2]!)?.[1]?.toLowerCase()
    const lvl = name ? /^heading ([123])$/.exec(name)?.[1] : undefined
    if (lvl) levelOfStyle.set(m[1]!, Number(lvl) as 1 | 2 | 3)
  }
  const xml = strFromU8(files['word/document.xml']!)
  const counters = [0, 0, 0]
  const sections: TemplateSection[] = []
  for (const p of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const styleId = /<w:pStyle w:val="([^"]+)"/.exec(p[0])?.[1]
    const level = styleId ? levelOfStyle.get(styleId) : undefined
    if (!level) continue
    const title = [...p[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
      .map((t) => t[1])
      .join('')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/^\s*\d+(\.\d+)*\.?\s+/, '')
      .trim()
    if (!title) continue
    counters[level - 1]! += 1
    for (let i = level; i < 3; i++) counters[i] = 0
    const id = counters
      .slice(0, level)
      .map((n) => Math.max(n, 1))
      .join('.')
    sections.push({ id, title: title.slice(0, 200), level, hint: '' })
  }
  return sections
}
