# Contributing

Thanks for helping. Bugs and small fixes: open a PR (or an issue if you're not sure how to fix it). Bigger changes or new features: open an issue first so we can agree on the approach before you spend time on it. Questions go to [Discussions](https://github.com/stagegrid/stagegrid/discussions); security problems to [SECURITY.md](SECURITY.md).

## Development

1. `nvm use` (Node 22) and `corepack enable` (pnpm version comes from `packageManager`).
2. `pnpm install`, `pnpm db:up`, then `pnpm dev`.
3. Write a failing test first, then the code. `pnpm test`, `pnpm lint`, `pnpm typecheck` must pass.
4. Add a changeset (`pnpm changeset`) when you change `@stagegrid/core`, `@stagegrid/mcp`, or `create-stagegrid` (they are released together, with the same version).
5. Conventional Commits: `feat(core): …`, `fix(admin): …`, `test: …`, `docs: …`, `chore: …`.

Layout and rules: see [CLAUDE.md](CLAUDE.md).

## Releasing (maintainers)

Releases are started by a maintainer, never automatically.

1. Merge the PRs that should ship (each with a changeset).
2. Actions → **Release** → Run workflow on `main`. It opens a **chore: version packages** PR that bumps versions and writes the changelogs. Review and merge it.
3. Run **Release** again. It publishes `@stagegrid/core`, `@stagegrid/mcp`, and `create-stagegrid` to npm and pushes `ghcr.io/stagegrid/stagegrid:<version>` and `:latest`.

Setup, once: an npm organization `stagegrid`, an npm token that can publish its packages and `create-stagegrid`, saved as the repository secret `NPM_TOKEN`. After the first release, check that the `stagegrid` container package on GitHub is public.

The version PR is opened by the workflow's token, so CI does not start on it by itself; push an empty commit to its branch (or close and reopen it) if CI is required before merging.

## First pull request

GitHub asks a maintainer to approve CI runs for a first-time contributor, so your checks may wait until someone clicks "Approve workflows to run". CI must pass before a PR can be merged.

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
