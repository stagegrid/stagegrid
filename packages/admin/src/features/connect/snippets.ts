/** Copy-paste setup for common MCP clients (spec 03 §8). */
export function mcpSnippets(mcpUrl: string, token: string) {
  const auth = `Bearer ${token}`
  return [
    {
      id: 'claude-code',
      title: 'Claude Code',
      body: `claude mcp add --transport http stagegrid ${mcpUrl} --header "Authorization: ${auth}"`,
    },
    {
      id: 'remote-json',
      title: 'Cursor, Windsurf, and other clients with remote MCP',
      body: JSON.stringify(
        { mcpServers: { stagegrid: { url: mcpUrl, headers: { Authorization: auth } } } },
        null,
        2,
      ),
    },
    {
      id: 'vscode',
      title: 'VS Code (.vscode/mcp.json)',
      body: JSON.stringify(
        { servers: { stagegrid: { type: 'http', url: mcpUrl, headers: { Authorization: auth } } } },
        null,
        2,
      ),
    },
    {
      id: 'claude-desktop',
      title: 'Claude Desktop (claude_desktop_config.json)',
      body: JSON.stringify(
        {
          mcpServers: {
            stagegrid: {
              command: 'npx',
              args: ['-y', '@stagegrid/mcp', '--url', mcpUrl, '--token', token],
            },
          },
        },
        null,
        2,
      ),
    },
  ]
}
