# Stagegrid guide for AI assistants

Stagegrid shows an IT project as a grid. **Items** (menus, screens, features — a tree, any depth) run down the side; **stages** (for example Design, Document, Database, Implement, QA, Deploy — each project has its own) run across the top. Every item × stage **cell** has one status:

| Status  | Meaning                  |
| ------- | ------------------------ |
| `skip`  | Not needed for this item |
| `todo`  | Not started              |
| `doing` | In progress              |
| `done`  | Finished                 |

Every status change is kept as history with the time it **happened** (which can be in the past) and who recorded it. Moving a cell from `done` back to `doing`/`todo` is a **reopen** and counts as rework. Cells stuck in `doing` too long, or past their planned end, are flagged **needs update**.

## Always start by reading

1. `list_projects` — find the project slug.
2. `get_board` with `format: "compact"` — see items (as paths) and statuses before changing anything. Legend: `-` skip, `T` todo, `P` doing, `D` done, suffix `*` needs update, `^n` reopened n times.

## Refer to things by name

- **Items** by full path with `>` between levels: `Settings > Master data > Vehicles`. Case and extra spaces don't matter. A bare child name (`Vehicles`) does not match — use the full path.
- **Stages** by name: `QA`.
- If you get `ambiguous_ref`, the error lists the candidates. Ask the user which one, or use the full path/id.

## Changing statuses: propose, confirm, then apply

For anything with more than one change, or any change that comes from another system (Jira, Linear, GitHub, a spreadsheet, a chat log):

1. Call `apply_changes` with `dryRun: true`.
2. Show the user a table: `Item › Stage | now | → new | when | source`.
3. **Wait for the user to confirm or correct it.** Never apply before they confirm.
4. Call `apply_changes` again with the confirmed list and `dryRun: false`.

A single change the user asked for directly ("mark Login QA as done") can be applied without a dry run.

## Use the source's time

Set `happenedAt` (ISO 8601 with offset, e.g. `2026-10-03T14:05:00+07:00`) to when it really happened — the time the Jira issue moved, the date in the meeting notes. Stagegrid builds its timeline from `happenedAt`, and people often update it days late. Omit it only when the change is happening now.

If the result says `backdatedBeforeLaterEvent: true`, the change was saved to history but the current status didn't change because a later update exists. Tell the user.

## Reopening

When moving a cell from `done` back to `doing` or `todo`, set `reason` (for example `"QA found a bug in email login"`).

## Building the tree

- `create_items` takes a whole tree at once: `{ "items": [{ "name": "Settings", "children": [{ "name": "Users" }] }] }`. Use `parent` to add under an existing item.
- Item names can't contain `>`.
- Every new item automatically gets a `todo` cell for every stage.
- `move_item`, `update_item` (rename), `delete_item` (also deletes children — confirm with the user first).
- Stages: `manage_stages` (project owners only) with ops `add`, `rename`, `move`, `archive`, `restore` — applied together or not at all.

## Answering questions

- "What's the status?" → `get_summary`, then `get_board` for details.
- "What's stuck / needs updating?" → `list_stale_cells`. Offer to check each against the user's tracker and propose updates.
- "What changed this week?" → `get_recent_changes`.
- "What happened with X?" → `get_cell` for its history and rework rounds.

## Errors

| Code               | What to do                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `ambiguous_ref`    | Several items match. Show the candidates and ask, or use the full path.                         |
| `not_found`        | Check names with `get_board`. The error suggests close matches.                                 |
| `validation_error` | Nothing was saved. Every problem is listed with its index; fix them all and retry.              |
| `forbidden`        | The user's role in this project doesn't allow it (viewers can only read; stages need an owner). |
| `conflict`         | For example the project is archived or a name is taken. Explain it to the user.                 |
