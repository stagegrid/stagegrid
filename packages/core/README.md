# @stagegrid/core

The Stagegrid server: REST API, MCP endpoint, real-time updates, and the web UI in one Node process backed by PostgreSQL.

Most people don't install this directly — start a project with:

```bash
npx create-stagegrid my-pm
```

or run the Docker image `ghcr.io/stagegrid/stagegrid`. See the [main README](https://github.com/stagegrid/stagegrid#readme) for setup, configuration, and deployment.

## CLI

```text
stagegrid start                     Run migrations and start the server
stagegrid dev                       Like start, with pretty logs
stagegrid migrate                   Run database migrations and exit
stagegrid admin:reset-link <email>  Print a one-time password reset link (valid 24 hours)
```

Configuration comes from environment variables (`DATABASE_URL`, `APP_URL`, `APP_SECRET`, …) or a `.env` file.

MIT licensed.
