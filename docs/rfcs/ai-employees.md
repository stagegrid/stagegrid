# RFC: AI employees and SDLC workflow

Status: Draft for maintainer review; not implemented or approved for release.
Tracking: [Issue #18](https://github.com/stagegrid/stagegrid/issues/18).
Date: 2026-10-09 (Asia/Bangkok).
Baseline inspected: `2878cf833afd4755cb0ce22810461fb4b553183e`.

## Summary

Stagegrid should be a shared workplace for people and named AI employees. Users can discuss ideas anywhere, preserve sources and decisions, generate customer-facing documents, approve a precise scope, assign implementation work, and inspect evidence of delivery.

The existing Stage overview remains the project-wide progress view. Kanban tasks supply its progress for explicitly task-managed cells. Employees communicate naturally within work threads: acknowledge assignments, report meaningful progress, ask questions, resume after answers, and hand over actual results. AI labels remain visible; natural language must not imply actions that did not happen.

This RFC preserves the product direction agreed in discussion. Technical defaults below remain proposals pending maintainer review. It is not an instruction to implement the entire vision in one pass.

## Existing foundation versus proposed work

The inspected repository has item/stage cells, cell assignees, comments, links, history and rework rounds; versioned documents and configurable document templates; HTTP/MCP service entry points; realtime updates; and a PostgreSQL backend. Its README lists BRD, SRS, meeting minutes, release notes, CR, UAT sign-off, and test summary templates.

Kanban-driven aggregation, independent employee identities, durable agent runs, question continuation, approval policy, and runner orchestration described here are additions. Existing templates do not imply that customer approval workflows already exist.

## Agreed product requirements

1. Preserve the Stage overview; Kanban updates it through explicit aggregation rules.
2. Name each employee independently of role, provider, model, and machine. Multiple employees may share a role. Provider changes do not erase employee identity or history.
3. Make people and AI work together with explicit permissions and accountable actions.
4. Store sources and curated knowledge at team, project, and task scope. External discussions can become referenced project decisions.
5. Generate editable documents from templates, including SRS and CR. Users will supply further templates incrementally.
6. Bind approvals to immutable document revisions. Draft changes do not inherit approval.
7. Pin a task's input context so Dev, Reviewer, and QA can work against the same agreement.
8. Make receive-work, question, answer, progress, handoff, and delivery visible in a task thread.
9. Support configurable workflow triggers over time. Keep actual execution separate from Stagegrid's workflow and authorization authority.
10. Keep the non-AI experience usable. AI employees are optional.

## Product surfaces

| Surface | Responsibility |
| --- | --- |
| Stage overview | Progress across items and stages; drill down to contributing tasks |
| Kanban | Task ownership, readiness, dependencies, review and acceptance |
| Knowledge | Sources, curated decisions, standards and relevant context |
| Documents | Templates, drafts, revision history, exports and approvals |
| Employees | Name, avatar, role, instructions, skills, permissions and runtime profile |
| Task conversation | Human and AI messages, questions, decisions and deliverables |
| Needs your attention | Pending questions, approvals, acceptance requests and failures |
| Runner settings | Machine availability, supported execution capabilities and run history |

## End-to-end example

A user discusses an appointment feature in an external AI chat. They import a source excerpt or file and its reference. An analyst drafts requirements and explicitly flags missing answers. The user confirms decisions and generates an SRS using a chosen template. A customer approves revision 3. Technical documents become ready and a task is assigned to an employee named Mali.

Mali receives the approved context bundle, claims the task and starts work. If simultaneous bookings are unspecified, Mali asks the user rather than choosing a business rule. The response is recorded; a scope change requires a new approved context bundle. Mali implements in an isolated worktree, submits a PR and verification evidence, and requests acceptance. Later phases add independent Reviewer and QA employees. Accepted tasks update the overview. A later CR references the existing baseline and records scope, schedule and cost impact before approval.

## Communication model

Natural wording is presentation over durable actions. A mention does not automatically assign work. A message saying that a review was requested is insufficient unless a review request was actually created.

Distinguish informational updates, answerable questions, decisions, approval requests and handoffs. Link each AI message to employee, task and run; identify document revisions and artifacts when relevant. Keep detailed runtime logs expandable, with concise milestone updates in the main conversation. Do not invent progress percentages or expose private reasoning traces.

General brainstorming and conversion into tasks/documents are later capabilities. The MVP centers on task-bound communication and a question inbox.

## Architecture direction

Stagegrid owns identity, permissions, tasks, knowledge, revisions, approvals, workflow transitions and evidence acceptance. A runner owns local execution, workspace preparation, process supervision and event delivery. Provider adapters translate execution into provider-neutral events.

An employee is persistent; a run is one execution attempt; a provider session is a runtime detail. A runner reconnect must not create a new task or repeat a side effect. Use durable dispatch, atomic claims, bounded leases and idempotency. Workflow permissions belong in services, not in the model prompt alone.

Build Stagegrid's work/document experience first. Keep runtime integration replaceable. Reusing Paperclip as an execution backend is an option to evaluate, not an adopted dependency or a proven drop-in integration.

## Knowledge, documents and approval

External URLs are provenance, not sufficient executable context: links may require login or change. Store the authorized relevant content or a pinned accessible snapshot. Separate raw sources, drafts, confirmed decisions and approved requirements. Retain contradictions as unresolved instead of silently favoring the newest text.

Support team standards, project knowledge and task-specific context with scoped access. A run receives only relevant authorized content. Source text is task data; it cannot override repository policy or grant permissions.

Document lifecycle proposal: draft, internal review, awaiting customer approval, changes requested, approved, superseded. Approval records identify actor, timestamp, revision and evidence. Initial human-recorded external approval must be labeled as such; it is not a verified customer e-signature. Customer portal and signature assurance are later scope.

CRs reference the approved baseline and affected requirements/tasks/tests. Human-reviewed impact and approval precede implementation of changed scope. Approval of an SRS and readiness for implementation remain distinct gates.

## Delivery phases

### MVP: one employee, one complete working loop

A named Dev receives a task with pinned context, waits for explicit Start, claims it, asks a blocking question, resumes after a valid answer, submits a PR and evidence, and waits for human acceptance. Acceptance drives the linked overview cell. Use one provider adapter initially and a fixed workflow.

### Later: team collaboration

Reviewer/QA roles, explicit handoffs, bounded rework, dependency-aware scheduling, richer employee profiles and reusable team settings.

### Later: broader SDLC

Customer approval portal, advanced template import, CR impact workflows, configurable hooks, release/deployment gates, rollback evidence, incidents and maintenance. These are roadmap items, not MVP promises.

## Alternatives and tradeoffs

| Option | Tradeoff |
| --- | --- |
| Only MCP plus manual AI invocation | Useful interim workflow, but does not provide durable assignment, automatic resume or run ownership |
| Stagegrid plus a separate full orchestration product | May reuse execution features; introduces duplicate task/permission/state authorities and synchronization work |
| Stagegrid services plus a small replaceable runner | Fits the existing product; requires reliable claims, continuation and failure handling |

The third option is the proposed starting point. Validate one real execution loop before building a generic automation designer.

## Decisions still needed

See the decision register in [the MVP spec](../features/ai-employees/spec.md). In particular, approve the first provider adapter, supported CLI contract, task aggregation defaults, document snapshot representation and runner authentication before implementation.

## References and limits

Reviewed 2026-10-09. References inform design; their capabilities have not been validated by running them in this project. Some upstream architecture documents are proposals and may lag runtime behavior.

- [Paperclip](https://github.com/paperclipai/paperclip): employee/task management and execution adapters.
- [Task workflow](https://github.com/paperclipai/paperclip/blob/master/docs/guides/agent-developer/task-workflow.md): atomic checkout, blockers, version-specific plan approval.
- [Adapters](https://github.com/paperclipai/paperclip/blob/master/docs/adapters/overview.md): provider-specific execution behind a common boundary.
- [Runner architecture](https://github.com/paperclipai/paperclip/blob/master/doc/architecture/paperclip-runner.md): proposed separation of execution from workflow authority.
- [ChatDev](https://github.com/OpenBMB/ChatDev): role-based communication; distinguish legacy virtual-company behavior from version 2.
- [MetaGPT](https://github.com/FoundationAgents/MetaGPT): role-specific artifacts and SOPs.
- [CrewAI collaboration](https://docs.crewai.com/v1.15.1/en/concepts/collaboration): delegation and coworker questions.

## Reading order

Continue with [MVP specification](../features/ai-employees/spec.md), [proposed API contract](../features/ai-employees/api-contract.md), and [implementation plan](../features/ai-employees/implementation-plan.md). These documents are self-contained handoff material; prior chat history is not required.
