# create-stagegrid

Creates a ready-to-run [Stagegrid](https://github.com/stagegrid/stagegrid) project: a self-hosted progress board for IT projects that AI assistants update over MCP.

```bash
npx create-stagegrid my-pm
cd my-pm
docker compose up -d db
npm run dev
```

Then open http://localhost:4000/setup and create the first admin.

## Options

```text
--db <docker|url>   Postgres in Docker (default) or an existing database
--db-url <url>      Connection string for an existing database (implies --db url)
--pm <name>         Package manager to install with (default: the one running this)
--skip-install      Only write the files
-h, --help          Show help
```

MIT licensed.
