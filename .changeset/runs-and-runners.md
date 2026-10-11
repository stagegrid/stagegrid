---
'@stagegrid/core': minor
---

Add durable runs and runners. An admin issues a one-time enrollment token that a runner exchanges for its own revocable credential. Start queues a run for an employee's task; a runner claims it with a fenced lease (one winner, idempotent), reports events, and completes it. Cancelling revokes the claim, a runner that goes quiet has its run interrupted, and late reports from an old lease are refused. A succeeded run submits the task for acceptance and never accepts it.
