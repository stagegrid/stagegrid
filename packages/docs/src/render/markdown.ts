import type { Block, Inline } from '../content'
import type { DocModel } from '../model'

const escMd = (s: string) => s.replace(/([\\`*_[\]|])/g, '\\$1')

function inl(xs: Inline[]): string {
  return xs
    .map((x) => {
      if (x.type === 'br') return '  \n'
      if (x.type === 'link') return `[${inl(x.children)}](${x.url})`
      let s = x.code ? `\`${x.value}\`` : escMd(x.value)
      if (x.italic) s = `*${s}*`
      if (x.bold) s = `**${s}**`
      return s
    })
    .join('')
}

function block(b: Block, indent = ''): string {
  if (b.type === 'p') return indent + inl(b.inlines)
  if (b.type === 'list') {
    return b.items
      .map((item, i) => {
        const marker = b.ordered ? `${i + 1}. ` : '- '
        const [first, ...rest] = item
        const head = first ? block(first).trimStart() : ''
        const tail = rest.map((x) => block(x, `${indent}   `)).join('\n')
        return `${indent}${marker}${head}${tail ? `\n${tail}` : ''}`
      })
      .join('\n')
  }
  const cell = (c: Inline[]) => inl(c).replace(/\n/g, ' ')
  const head = `| ${b.header.map(cell).join(' | ')} |`
  const sep = `| ${b.header.map(() => '---').join(' | ')} |`
  return [head, sep, ...b.rows.map((r) => `| ${r.map(cell).join(' | ')} |`)]
    .map((l) => indent + l)
    .join('\n')
}

export function renderMarkdown(doc: DocModel): string {
  const out = [
    `# ${doc.meta.title}`,
    '',
    `${doc.meta.project} · v${doc.meta.version} · ${doc.meta.date} · ${doc.meta.author}`,
  ]
  for (const b of doc.blocks) {
    out.push('')
    if (b.type === 'heading') out.push(`${'#'.repeat(b.level + 1)} ${b.text}`)
    else if (b.type === 'fields') {
      out.push('| | |', '| --- | --- |')
      for (const r of b.rows)
        out.push(
          `| **${escMd(r.label)}** | ${r.value.map((x) => block(x).replace(/\n/g, '<br>')).join('<br>')} |`,
        )
    } else out.push(block(b))
  }
  return `${out.join('\n')}\n`
}
