---
'@stagegrid/core': minor
---

Add the tasks API: create, edit and move tasks through their states, and switch a cell to task-managed progress. A task-managed cell derives its status from its required tasks; direct status writes (including `apply_changes`) and history edits on it return a conflict that says why.
