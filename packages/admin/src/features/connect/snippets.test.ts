import { describe, expect, it } from 'vitest'

import { mcpSnippets } from './snippets'

describe('mcpSnippets', () => {
  it('fills the URL and token into every client format', () => {
    const s = mcpSnippets('https://pm.example.com/mcp', 'sg_pat_abc')
    expect(s.map((x) => x.id)).toEqual(['claude-code', 'remote-json', 'vscode', 'claude-desktop'])
    expect(s[0]!.body).toBe(
      'claude mcp add --transport http stagegrid https://pm.example.com/mcp --header "Authorization: Bearer sg_pat_abc"',
    )
    expect(JSON.parse(s[3]!.body).mcpServers.stagegrid.args).toEqual([
      '-y',
      '@stagegrid/mcp',
      '--url',
      'https://pm.example.com/mcp',
      '--token',
      'sg_pat_abc',
    ])
  })
})
