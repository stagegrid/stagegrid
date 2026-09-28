import type { Block, Inline } from '../content'

export const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Collects what the body needs from the rest of the package (hyperlink relationships, list numbering instances). */
export interface BodyContext {
  headingStyle: (level: 1 | 2 | 3) => string | null
  link(url: string): string
  /** A fresh numbering instance for one list (so ordered lists restart at 1). */
  listNum(ordered: boolean): number
}

function runs(xs: Inline[], ctx: BodyContext): string {
  return xs
    .map((x) => {
      if (x.type === 'br') return '<w:r><w:br/></w:r>'
      if (x.type === 'link') {
        const inner = runs(x.children, ctx)
          .replace(/<w:rPr>/g, '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/>')
          .replace(
            /<w:r>(?!<w:rPr>)/g,
            '<w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>',
          )
        return `<w:hyperlink r:id="${ctx.link(x.url)}">${inner}</w:hyperlink>`
      }
      const props = [
        x.bold ? '<w:b/><w:bCs/>' : '',
        x.italic ? '<w:i/><w:iCs/>' : '',
        x.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
      ].join('')
      return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(x.value)}</w:t></w:r>`
    })
    .join('')
}

const para = (content: string, pPr = '') =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`

const BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`)
    .join('') +
  '</w:tblBorders>'

function table(rows: string[][], headerRow: boolean): string {
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.floor(9000 / cols)}"/>`).join('')}</w:tblGrid>`
  const trs = rows
    .map((r, i) => {
      const cells = r
        .map(
          (c) =>
            `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${headerRow && i === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : ''}</w:tcPr>${c}</w:tc>`,
        )
        .join('')
      return `<w:tr>${headerRow && i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`
    })
    .join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${BORDERS}<w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${trs}</w:tbl>`
}

export function blockXml(b: Block, ctx: BodyContext, level = 0): string {
  if (b.type === 'p') return para(runs(b.inlines, ctx))
  if (b.type === 'list') {
    const numId = ctx.listNum(b.ordered)
    return b.items
      .map((item) =>
        item
          .map((x, i) => {
            if (x.type === 'p' && i === 0)
              return para(
                runs(x.inlines, ctx),
                `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`,
              )
            return blockXml(x, ctx, Math.min(level + 1, 1))
          })
          .join(''),
      )
      .join('')
  }
  const rows = [b.header, ...b.rows].map((r) => r.map((c) => para(runs(c, ctx))))
  return table(rows, true) + para('')
}

export function headingXml(level: 1 | 2 | 3, text: string, ctx: BodyContext): string {
  const style = ctx.headingStyle(level)
  const t = `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`
  if (style) return para(t, `<w:pStyle w:val="${style}"/>`)
  const size = { 1: 32, 2: 28, 3: 24 }[level]
  return para(
    `<w:r><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size + 8}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`,
    '<w:spacing w:before="240" w:after="120"/>',
  )
}

export function fieldsXml(rows: { label: string; value: Block[] }[], ctx: BodyContext): string {
  return (
    table(
      rows.map((r) => [
        para(
          `<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${xmlEscape(r.label)}</w:t></w:r>`,
        ),
        r.value.map((b) => blockXml(b, ctx)).join('') || para(''),
      ]),
      false,
    ) + para('')
  )
}
