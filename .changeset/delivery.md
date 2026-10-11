---
'@stagegrid/core': minor
---

Add delivery and human acceptance for AI employees. A run that succeeds must report what it delivered (the commit, where it lives, the checks run against it); without evidence it can't be accepted as completed work. The runner looks at the worktree itself, runs the project's test command and reports its exit code, and the evidence is labelled as the agent's word, the runner's check or CI's. Projects choose how far work may leave the runner (keep local, push a branch, open a pull request); pull requests are reused on retries. A person accepts a specific submission, commit and context: a newer delivery replaces the old one, so an earlier acceptance can never cover a new commit. Accepting finishes the task and lets its cell recompute; nothing is merged.
