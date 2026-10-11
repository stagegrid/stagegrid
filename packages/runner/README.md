# @stagegrid/runner

Runs Stagegrid AI employees' work on a machine you control. The runner claims queued runs from
your Stagegrid server, prepares an isolated git worktree for each task, drives Claude Code or Codex
in it, and reports progress and the result back. It decides nothing about the workflow: Stagegrid
owns permissions, task states and acceptance.

Not published yet (`private`); run it from a checkout with `pnpm --filter @stagegrid/runner build`.

## Set up

1. In Stagegrid, as an admin, create an enrollment token for the projects this machine may work on
   (`POST /api/v1/runner-enrollments`). It works once and expires after an hour.
2. Enroll. The runner keeps its own revocable credential in `~/.stagegrid-runner/config.json`
   (readable by you only); the token is not stored.

   ```bash
   node packages/runner/dist/cli.js enroll --url https://stagegrid.example.com --token sg_enroll_…
   ```

3. Point each project at an existing clone of its repository, then check everything:

   ```bash
   node packages/runner/dist/cli.js repo my-project ~/code/my-project --base main
   node packages/runner/dist/cli.js doctor
   node packages/runner/dist/cli.js start
   ```

## What it does and doesn't do

- Work happens in `~/.stagegrid-runner/worktrees/<project>/stagegrid-task-<id>` on the branch
  `stagegrid/task-<id>`. Your own checkout is never switched, reset or stashed.
- It never pushes, and the agent is told so and denied `git push` and `git remote`.
- A run that hits the provider's usage limit waits and continues the same session after the reset.
  Ceilings (how much of the 5-hour and weekly windows employees may use) are set per runner in
  Stagegrid.
- Claude Code runs without your hooks, plugins, MCP servers or slash commands
  (`--setting-sources project --strict-mcp-config --disable-slash-commands`). Codex reads its login
  from `~/.codex`; set `codexHome` in the config to give it a separate home.
- Per-run budget cap for Claude Code: `providers.claude_code.maxBudgetUsd`.

## Config

```json
{
  "url": "https://stagegrid.example.com",
  "credential": "sg_runner_…",
  "repos": { "my-project": { "path": "/home/me/code/my-project", "baseBranch": "main" } },
  "providers": { "claude_code": { "maxBudgetUsd": 2 }, "codex": {} }
}
```
