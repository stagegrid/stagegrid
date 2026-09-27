import type { Block, Inline } from '../content'
import type { DocModel } from '../model'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inl(xs: Inline[], xhtml: boolean): string {
  return xs
    .map((x) => {
      if (x.type === 'br') return xhtml ? '<br />' : '<br>'
      if (x.type === 'link') return `<a href="${esc(x.url)}">${inl(x.children, xhtml)}</a>`
      let s = esc(x.value)
      if (x.code) s = `<code>${s}</code>`
      if (x.italic) s = `<em>${s}</em>`
      if (x.bold) s = `<strong>${s}</strong>`
      return s
    })
    .join('')
}

function block(b: Block, xhtml: boolean): string {
  if (b.type === 'p') return `<p>${inl(b.inlines, xhtml)}</p>`
  if (b.type === 'list') {
    const tag = b.ordered ? 'ol' : 'ul'
    return `<${tag}>${b.items.map((item) => `<li>${item.map((x) => block(x, xhtml)).join('')}</li>`).join('')}</${tag}>`
  }
  const head = `<tr>${b.header.map((c) => `<th>${inl(c, xhtml)}</th>`).join('')}</tr>`
  const rows = b.rows
    .map((r) => `<tr>${r.map((c) => `<td>${inl(c, xhtml)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><tbody>${head}${rows}</tbody></table>`
}

/**
 * HTML body for preview/print (section level n → h(n+1), the title is h1), or Confluence storage
 * format (XHTML; section level n → h(n), since Confluence shows the page title itself).
 */
export function renderHtml(doc: DocModel, opts: { confluence?: boolean } = {}): string {
  const xhtml = !!opts.confluence
  const parts: string[] = []
  if (!xhtml) {
    parts.push(`<h1>${esc(doc.meta.title)}</h1>`)
    parts.push(
      `<p class="doc-meta">${esc(doc.meta.project)} · v${doc.meta.version} · ${esc(doc.meta.date)} · ${esc(doc.meta.author)}</p>`,
    )
  }
  for (const b of doc.blocks) {
    if (b.type === 'heading') {
      const level = xhtml ? b.level : b.level + 1
      parts.push(`<h${level}>${esc(b.text)}</h${level}>`)
    } else if (b.type === 'fields') {
      parts.push(
        `<table><tbody>${b.rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${r.value.map((x) => block(x, xhtml)).join('')}</td></tr>`).join('')}</tbody></table>`,
      )
    } else parts.push(block(b, xhtml))
  }
  return parts.join('\n')
}

export const renderConfluence = (doc: DocModel) => ({
  title: doc.meta.title,
  body: renderHtml(doc, { confluence: true }),
})
