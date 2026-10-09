# AI employees: MVP behavior specification

Status: Draft. Product direction agreed; technical defaults require maintainer review.
Parent: [RFC](../../rfcs/ai-employees.md).

## Goal and boundary

Demonstrate a real loop: named Dev -> assigned task -> pinned context -> explicit start -> claim -> question -> authorized answer -> resumed execution -> PR/evidence -> human acceptance -> overview update.

No production deployment, automatic merge, autonomous employee hiring, general workflow builder, multi-provider failover, customer portal or full multi-agent review in MVP. A PR is a deliverable, not proof that work is accepted or deployed.

## Domain entities (proposed)

| Entity | Meaning and minimum data |
| --- | --- |
| Employee | Stable ID, display name, optional avatar, role, instructions, enabled state, project scope, runtime profile |
| Task | Project, title, scope, acceptance criteria, owner, state, version, dependencies, target cell |
| TaskContextRevision | Immutable manifest of requirement/document revisions, decisions, source snapshots, repo/base commit and instructions version |
| Run | Task, employee, runner, context revision, attempt, state, timestamps, result; one active execution per task |
| Claim | Run, runner, expiry, monotonically advancing fencing token |
| Message | Sender identity, task, optional run, kind, body, time, references |
| Question | Task/run/context revision, prompt, authorized responder scope, state, answer and answerer |
| Artifact | PR/commit/document/test-report reference, origin run, revision/commit, verification metadata |
| Acceptance | Human actor, context revision, deliverable commit/artifacts, decision, time and reason |
| Runner | Machine identity, project/repo allowlist, capabilities, health, capacity |

Never use display names as identity or authorization keys. Renaming an employee keeps audit history and stable IDs. Archiving prevents new work without deleting existing records. Provider changes apply to future runs; in-flight runs retain their original configuration.

## Task and run states are separate

Proposed task states: `draft`, `ready`, `in_progress`, `waiting_for_answer`, `ready_for_acceptance`, `changes_requested`, `done`, `cancelled`.

Proposed run states: `queued`, `running`, `waiting_for_answer`, `succeeded`, `failed`, `cancelled`, `interrupted`.

A successful run submits work for acceptance; it cannot mark the task done. Runner loss interrupts execution and creates an attention item; it is not success. The task remains in progress with a visible execution problem until retried, reassigned or cancelled.

| Action | Preconditions | Result |
| --- | --- | --- |
| Mark ready | Scope/criteria complete, required context pinned, approvals valid, dependencies satisfied, owner selected | Task ready |
| Start | Authorized human, task ready or approved rework, no active run, runner/provider available | Durable queued run; task stays ready until claimed (or changes_requested during rework) |
| Claim | Eligible runner, queued run, atomic lease acquisition | Task in_progress; run running |
| Ask blocking question | Active claim; explicit target responder | Question open; task/run waiting_for_answer |
| Answer | Authorized human; open non-superseded question and matching version | One durable continuation; task in_progress; run queued/running as supported |
| Submit result | Current claim/context; artifact metadata and verification evidence present | Run succeeded; task ready_for_acceptance |
| Accept | Authorized human reviews exact context/artifact commit | Task done; acceptance event; aggregate overview |
| Request changes | Human supplies actionable feedback | Task changes_requested; next run links earlier work |
| Cancel | Authorized human | Revoke claim, stop process, cancel pending questions and continuation |

MVP proposal: at most one unresolved blocking question per task. A nonblocking update never pauses execution. Repeated answers or retried callbacks do not create multiple continuations. If a session cannot resume, a replacement attempt uses the same workspace/checkpoint and recorded answer; recovery must not blindly repeat completed external actions.

## Context and scope change

Read the approved pinned content, not mutable latest documents. When any input changes, show a context-outdated flag. Do not hot-swap a running task's contract. A human decides whether to continue the approved baseline or cancel/supersede and start with a new revision.

An answer that changes accepted requirements creates a proposed decision/change, not silent approval. Renew the affected approval/context before implementing changed scope. Clarifications within existing scope can resume directly, with the answer recorded.

For external context, retain source URL plus authorized relevant text/file snapshot and retrieval time. Missing/inaccessible required content blocks readiness. A raw unreviewed conversation is not an approved requirement.

## Conversation experience

Show employee name, role and AI badge; show human identity for responses. Event types: acknowledgment, progress, question, decision, delivery, execution_failure. Keep logs behind expandable details. Report real actions only, with PR/test links and commit references where relevant.

Questions appear in the task thread and Needs your attention. Users can answer there, inspect context and see why work is blocked. MVP refresh/realtime must show answers and continuation consistently. Plain comments and mentions do not start work; explicit Start/Answer/Request changes actions do.

Example: employee asks whether simultaneous bookings must reject the second request. The user answers once. The system persists the answer before dispatching continuation. After reload the answer is still visible and the employee resumes only once. If this changes SRS scope, continuation waits for the updated approved baseline.

## Overview compatibility and aggregation

Proposed MVP mapping: one task targets one existing cell (`item x stage`). Multiple tasks may contribute to a cell. Use child tasks for separate cells rather than ambiguous multi-cell completion.

Add explicit cell progress mode: existing cells remain `manual`; opting into `tasks` makes task aggregation the authority. Never silently convert existing cells. Direct status writes, including MCP, to a task-managed cell should return a conflict explaining that contributing tasks must be updated; other existing edits remain available.

Required active tasks only contribute. Cancelled/optional tasks are excluded; exclusion and reopening are audited. Proposed calculation:

- No required active tasks: todo, not vacuous done.
- All required tasks accepted as done: done.
- Any required task started, waiting, awaiting acceptance, in rework or done while another is pending: doing.
- Otherwise: todo.

Skip remains an explicit stage/cell decision: switching a task-managed cell to skip requires resolving or cancelling active contributing work first. Reopening an accepted contributing task recomputes the cell and records a reason/rework through existing domain rules. Restoring manual mode is an explicit owner action with audit history.

## Authorization and execution boundaries

Map new operations to current project membership/service authorization; do not introduce an unrelated role hierarchy. Humans authorize starts, answers and acceptance according to project permissions. A Dev cannot approve its own requirements or acceptance. An employee acts only within assigned projects/repos. Runner credentials are scoped and revocable; secrets are excluded from contexts, artifacts and logs.

Each task uses an isolated branch/worktree and known base commit. Never modify the user's active checkout or force-push by default. Resume work on its recorded branch. PR creation/push requires explicit project-level permission and must be repeat-safe by recording or looking up an existing PR for that branch. Merge/deploy remain outside MVP authority.

MCP/HTTP handlers validate inputs and delegate to services. All task transitions check state, version, identity and permission on the server. Claim expiry fences off stale results. A late callback after cancellation may be retained as diagnostics but cannot revive or complete the task.

## Acceptance scenarios

| ID | Scenario and expected result |
| --- | --- |
| AC-01 | Create Mali as Dev, rename, change future runtime: stable identity/history remain |
| AC-02 | Required context absent or approval stale: Ready/Start rejected with reason |
| AC-03 | Two runners claim same queued work: exactly one valid claim |
| AC-04 | Ask, answer, refresh and replay answer: one durable response and one continuation |
| AC-05 | Wrong-project user answers or accepts: denied without mutation |
| AC-06 | Runner offline before Start: actionable unavailable state; no false running status |
| AC-07 | Runner disconnects mid-run: expiry/interruption visible, no automatic done |
| AC-08 | Lease expires and old process reports success: result cannot change task |
| AC-09 | Spec changes during run: context flagged, pinned input unchanged |
| AC-10 | Submission lacks required evidence: not accepted as completed work |
| AC-11 | PR submitted with evidence: ready_for_acceptance, not done |
| AC-12 | Human accepts exact commit/context: task done and cell recalculated |
| AC-13 | Two required tasks, only one accepted: cell doing; both accepted: done |
| AC-14 | Reopen accepted task: cell doing and reason retained |
| AC-15 | AI disabled/manual cell: existing HTTP/MCP workflows continue unchanged |
| AC-16 | Cancel while waiting: later answer/callback cannot restart execution |
| AC-17 | Retried delivery: no duplicate artifact, PR or completion message |
| AC-18 | PR head changes after submission: previous acceptance cannot silently cover new commit |

## Decision register

| ID | Proposed default | Status |
| --- | --- | --- |
| D-01 | One task -> one cell; explicit task/manual mode | Review required |
| D-02 | Explicit human Start; fixed workflow | Proposed MVP default |
| D-03 | One provider first; choose Claude Code or Codex after capability spike | Unresolved blocker for runner implementation |
| D-04 | Immutable manifest plus stored referenced revisions/snapshots | Review representation and export compatibility |
| D-05 | Scoped runner enrollment token exchanged for revocable execution credentials | Security/transport contract review required |
| D-06 | No required tasks -> todo; optional/cancelled tasks excluded | Review required |
| D-07 | One blocking question; durable resume/restart capability | Validate chosen provider |
| D-08 | Human project owner/editor permissions mapped by service action | Confirm exact current role mapping |

An implementing agent must summarize these decisions and resolve relevant blockers before code changes. Do not treat draft defaults as already approved runtime behavior.
