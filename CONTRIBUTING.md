# Contributing

1. `nvm use` (Node 22) and `corepack enable` (pnpm version comes from `packageManager`).
2. `pnpm install`, `pnpm db:up`, then `pnpm dev`.
3. Write a failing test first, then the code. `pnpm test`, `pnpm lint`, `pnpm typecheck` must pass.
4. Add a changeset (`pnpm changeset`) when you change `@stagegrid/core` or `create-stagegrid`.
5. Conventional Commits: `feat(core): …`, `fix(admin): …`, `test: …`, `docs: …`, `chore: …`.

Layout and rules: see [CLAUDE.md](CLAUDE.md).
