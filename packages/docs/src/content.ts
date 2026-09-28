import type { Nodes as MdNode, RootContent } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table'
import { gfmTable } from 'micromark-extension-gfm-table'

/** The small content model every renderer understands (spec 06 §3.2 "content markdown"). */
export type Inline =
  | { type: 'text'; value: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { type: 'link'; url: string; children: Inline[] }
  | { type: 'br' }

export type Block =
  | { type: 'p'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Block[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }

const safeUrl = (u: string) => /^https?:\/\//i.test(u)

function inlines(nodes: MdNode[], marks: { bold?: boolean; italic?: boolean } = {}): Inline[] {
  const out: Inline[] = []
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out.push({ type: 'text', value: n.value, ...marks })
        break
      case 'strong':
        out.push(...inlines(n.children, { ...marks, bold: true }))
        break
      case 'emphasis':
        out.push(...inlines(n.children, { ...marks, italic: true }))
        break
      case 'delete':
        out.push(...inlines(n.children, marks))
        break
      case 'inlineCode':
        out.push({ type: 'text', value: n.value, code: true, ...marks })
        break
      case 'break':
        out.push({ type: 'br' })
        break
      case 'link':
        if (safeUrl(n.url))
          out.push({ type: 'link', url: n.url, children: inlines(n.children, marks) })
        else out.push(...inlines(n.children, marks))
        break
      case 'image':
        if (n.alt) out.push({ type: 'text', value: n.alt, ...marks })
        break
      case 'html':
        out.push({ type: 'text', value: n.value, ...marks })
        break
      default:
        if ('children' in n) out.push(...inlines(n.children as MdNode[], marks))
        else if ('value' in n && typeof n.value === 'string')
          out.push({ type: 'text', value: n.value, ...marks })
    }
  }
  return out
}

function blocks(nodes: RootContent[], depth = 0): Block[] {
  const out: Block[] = []
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph':
        out.push({ type: 'p', inlines: inlines(n.children) })
        break
      case 'heading':
        // Headings come from the template; a heading in content becomes a bold paragraph.
        out.push({ type: 'p', inlines: inlines(n.children, { bold: true }) })
        break
      case 'list':
        if (depth >= 2) {
          for (const item of n.children) out.push(...blocks(item.children, depth))
        } else {
          out.push({
            type: 'list',
            ordered: !!n.ordered,
            items: n.children.map((item) => blocks(item.children, depth + 1)),
          })
        }
        break
      case 'table': {
        const [head, ...rest] = n.children
        out.push({
          type: 'table',
          header: (head?.children ?? []).map((c) => inlines(c.children)),
          rows: rest.map((r) => r.children.map((c) => inlines(c.children))),
        })
        break
      }
      case 'code':
        out.push({
          type: 'p',
          inlines: n.value
            .split('\n')
            .flatMap((line, i) => [
              ...(i ? [{ type: 'br' as const }] : []),
              { type: 'text' as const, value: line, code: true },
            ]),
        })
        break
      case 'blockquote':
        out.push(...blocks(n.children, depth))
        break
      case 'html':
        out.push({ type: 'p', inlines: [{ type: 'text', value: n.value }] })
        break
      default:
        break
    }
  }
  return out
}

export function parseContent(markdown: string): Block[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  })
  return blocks(tree.children)
}

export const plainText = (xs: Inline[]): string =>
  xs
    .map((x) => (x.type === 'text' ? x.value : x.type === 'br' ? '\n' : plainText(x.children)))
    .join('')
