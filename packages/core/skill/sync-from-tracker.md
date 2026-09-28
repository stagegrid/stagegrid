# Sync Stagegrid from {{source}}

Goal: make Stagegrid match what {{source}} says, with the user's approval.

1. `list_projects`, then `get_board` (compact) for the project the user means. Ask if it's unclear.
2. Read {{source}} with the tools you have for it (for example a Jira or Linear MCP server). Collect, per work item: its title, status, assignee, and **when its status last changed**.
3. Match each work item to a Stagegrid item path and stage. Use the names, the item tree, and anything the user told you. If a match is a guess, mark it as a guess.
4. Build the change list. Map the tracker's status to `todo` / `doing` / `done` (ask the user once if the mapping isn't obvious). Use the tracker's status-change time as `happenedAt`.
5. Call `apply_changes` with `dryRun: true`. Show the user:

   | Item › Stage | Now | → New | When | From |
   | ------------ | --- | ----- | ---- | ---- |

   List unmatched tracker items separately.

6. Wait for the user to confirm or correct. Then call `apply_changes` with `dryRun: false`.
7. Finish with `list_stale_cells` and mention anything still stale.

Never apply changes the user hasn't confirmed.
