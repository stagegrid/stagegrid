# Stagegrid — guide for AI coding agents

## Layout

| Path                        | What                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/shared`           | zod schemas, types, constants shared by server and UI (never published; bundled into core)            |
| `packages/core`             | `@stagegrid/core`: Hono server, Drizzle/Postgres, services, realtime, CLI `stagegrid`                 |
| `packages/admin`            | React SPA (Vite, TanStack Router/Query, shadcn radix-nova, Tailwind v4); built into `core/dist/admin` |
| `packages/create-stagegrid` | `npx create-stagegrid` scaffolder                                                                     |
| `examples/dev-app`          | local `.env` for `pnpm dev`                                                                           |
| `e2e`                       | Playwright specs (run after `pnpm build`)                                                             |

## Rules

- **Business logic lives in `packages/core/src/services`.** Routes (`src/http/routes`) and MCP tools (`src/mcp/tools`) only parse input (zod from `@stagegrid/shared`) and call a service. Permission checks happen in services via `requireProjectRole` / `requireAdmin`, never in routes.
- **`src/domain` is pure** (no DB, no HTTP) and fully unit-tested. `services` must not import `http`.
- Every mutation: runs in `withTx`, writes `audit()`, and calls `notify()` for realtime. `notify` inside the transaction means rollbacks (and dry runs) never emit events.
- Dates shown to users or used as day boundaries go through `zonedDate()` with the project's time zone. Never `toISOString().slice(0, 10)` for "today".
- Never hard-delete business data: `deleted_at` / `archived_at`.
- UI: colors only through CSS variables in `packages/admin/src/index.css`; English copy, sentence case, no "successfully"/"please".
- Schema change: edit `packages/core/src/db/schema/*`, then `pnpm --filter @stagegrid/core db:generate --name <change>`; commit the SQL.

## Commands

```bash
pnpm db:up             # Postgres for dev/test on :54329
pnpm test              # all unit + integration tests (needs Postgres)
pnpm lint && pnpm typecheck
pnpm build && pnpm e2e
```

- TypeScript is pinned to 6.x (tsup's declaration build and typescript-eslint don't support 7 yet).
- pnpm is pinned via `packageManager`; use `corepack enable`.

## Testing

- TDD. Service tests use a real Postgres (`test/helpers/db.ts` truncates before each test); build data with `test/helpers/factories.ts`.
- When fixing a bug, prove the test catches it: revert the fix, see the test fail, restore.
- Never skip or weaken a test to get green.
