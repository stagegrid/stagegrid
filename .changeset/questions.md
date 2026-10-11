---
'@stagegrid/core': minor
---

Add question batches and continuation. A blocked employee asks several questions at once; its run pauses and the task shows it is waiting for an answer. People with editor access answer one by one; the run continues exactly once, after the last answer, with every answer. Repeated answers change nothing, cancelling the run or task cancels open questions so a late answer can't restart work, and an answer that changes scope waits for a new pinned context. New `/attention` and task `/thread` endpoints list what needs a person and tell a task's story.
