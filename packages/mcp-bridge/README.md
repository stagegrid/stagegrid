# @stagegrid/mcp

A stdio bridge to a [Stagegrid](https://github.com/stagegrid/stagegrid) MCP server, for MCP clients that can only start local commands (for example Claude Desktop's config file). Clients that support remote HTTP servers should connect to `<APP_URL>/mcp` directly instead.

```bash
npx -y @stagegrid/mcp --url https://pm.example.com/mcp --token sg_pat_…
```

or set `STAGEGRID_URL` and `STAGEGRID_TOKEN`. Create a token in Stagegrid under **Connect AI** or **Profile → API tokens**.

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "stagegrid": {
      "command": "npx",
      "args": ["-y", "@stagegrid/mcp", "--url", "https://pm.example.com/mcp", "--token", "sg_pat_…"]
    }
  }
}
```

MIT licensed.
