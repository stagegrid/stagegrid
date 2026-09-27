# Stagegrid

See your whole IT project on one grid — items (menus, features) down the side, stages
(Design → Deploy) across the top — and let any AI update it through MCP.

- **One screen for progress.** Every cell is skip / to do / doing / done, with history,
  rework rounds, and "needs update" flags when data goes stale.
- **AI-first.** Connect Claude, ChatGPT, Cursor, or any MCP client and say
  "Login back-end is done since Monday" or "sync this week's Jira into Stagegrid".
- **Live.** Changes from the web or from AI appear on every open board instantly.
- **Self-hosted, MIT.** One Node process and PostgreSQL.

## Quick start

```bash
npx create-stagegrid my-pm
cd my-pm
docker compose up -d db
npm run dev
```

Open http://localhost:4000/setup and create the first admin.

## Connect an AI assistant

In Stagegrid, click **Connect AI**: it shows the MCP URL (`<APP_URL>/mcp`), creates a token, and gives copy-paste setup for Claude Code, Cursor, VS Code, and Claude Desktop. For clients that only speak stdio:

```bash
npx -y @stagegrid/mcp --url https://pm.example.com/mcp --token sg_pat_…
```

The server ships its own guide as MCP prompts/resources, and **Download AI skill** gives a Claude skill plus a plain guide for other assistants.

## Configuration

| Variable           | Required | Default   |                                           |
| ------------------ | -------- | --------- | ----------------------------------------- |
| `DATABASE_URL`     | yes      |           | `postgres://…`                            |
| `APP_URL`          | yes      |           | Public URL, e.g. `https://pm.example.com` |
| `APP_SECRET`       | yes      |           | 32+ random characters                     |
| `PORT`             |          | `4000`    |                                           |
| `HOST`             |          | `0.0.0.0` |                                           |
| `LOG_LEVEL`        |          | `info`    |                                           |
| `TRUST_PROXY`      |          | `false`   | `true` behind a reverse proxy             |
| `SESSION_TTL_DAYS` |          | `30`      |                                           |

Forgot the admin password? On the server: `npx stagegrid admin:reset-link you@example.com`.

## Deploy

- **Docker:** `docker run -e DATABASE_URL=… -e APP_URL=… -e APP_SECRET=… -p 4000:4000 ghcr.io/stagegrid/stagegrid`
- **Node:** `npm start` in the folder create-stagegrid made. Migrations run on start.
- **Reverse proxy:** server-sent events need buffering off. nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:4000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
location ~ ^/api/v1/projects/[^/]+/stream$ {
  proxy_pass http://127.0.0.1:4000;
  proxy_buffering off;
  proxy_read_timeout 1h;
}
```

Running several instances behind a load balancer works (realtime goes through PostgreSQL),
but login rate limiting is per process.

## Development

```bash
nvm use && corepack enable
pnpm install
pnpm db:up                       # Postgres on :54329
cp examples/dev-app/.env.example examples/dev-app/.env
pnpm dev                         # API :4000 + UI :5173
pnpm test && pnpm lint && pnpm typecheck
pnpm build && pnpm e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
