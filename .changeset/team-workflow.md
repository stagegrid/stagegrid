---
'@stagegrid/core': minor
---

Add the team workflow: Analyst, Dev, Reviewer and QA employees hand an item's work along its stages, and a person accepts every stage. The Analyst drafts a requirement document and accepting it approves that exact version, which Dev work then needs. A Reviewer checks Dev's delivery in a fresh read-only checkout (advice only, never an approval) and can send it back; QA tests the accepted commit and can reopen the work. Rework is bounded by a per-project limit, after which a person is asked to decide. Accepting a stage creates the next role's task exactly once. Everything is off by default; with the Reviewer and QA off, tasks behave as before.
