---
'@stagegrid/core': minor
---

Add named AI employees (role, runtime, instructions, archive) and pinned task context: immutable revisions of documents, source snapshots and decisions. Work assigned to an employee can't be marked ready without a pinned context, and documents that change after pinning are flagged as outdated while the pinned content stays as agreed. New MCP tools `list_employees` and `get_task_context`.
