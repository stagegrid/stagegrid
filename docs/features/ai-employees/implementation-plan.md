# AI employees: phased implementation plan

Status: Draft handoff plan; no feature implementation has started.
Read [RFC](../../rfcs/ai-employees.md), [spec](spec.md) and [contract](api-contract.md).
Baseline: `2878cf833afd4755cb0ce22810461fb4b553183e`; re-inspect current code before editing.

## Phase 0 — approve decisions and validate a provider

Resolve the decision register, especially first provider, local CLI capabilities, authentication and pinned context. Run a disposable integration spike: launch, stream progress, ask a question, stop/resume or restart from a checkpoint, cancel, capture artifacts. Use an isolated test repository and explicitly authorized credentials. Do not claim a provider supports resumable input until verified.

Exit: documented supported version/capabilities and failure cases, reviewed API contract, agreed readiness/aggregation semantics. If the first provider cannot pause interactively, prove durable checkpoint/restart without duplicate side effects before selecting it.

## Phase 1 — tasks and overview integration

Backend: add task state/version, task-to-cell mapping and explicit progress mode in Drizzle schema; generate migration using existing commands. Put pure aggregation/state rules in core domain and transactional transitions in services. Preserve manual mode and existing audit/rework behavior. Reuse service authorization, notify and transaction conventions.

Frontend: add Kanban and contributing-task navigation from cells. Display blocked/awaiting-acceptance distinctions. Explain why direct status changes are unavailable for task-managed cells.

Exit: AC-13/14/15; integration tests prove rollback has no realtime/audit side effects and reopening recomputes existing cell history correctly.

## Phase 2 — employee profiles and pinned context

Add persistent employee identity distinct from users, roles, runtime profiles and run snapshots. Extend attribution carefully without pretending an employee is a human account. Add minimum context manifests using existing document revisions; preserve source snapshots and approval metadata.

Frontend: named Dev profile, role/AI badge, runtime availability, context selection and readiness errors. Start with simple optional avatar; custom avatar uploads can be deferred.

Exit: AC-01/02/05/09; unauthorized cross-project sources rejected; revision changes never mutate approved context.

## Phase 3 — durable work dispatch and runner

Add runs, claims, leases, fencing and dispatch outbox using PostgreSQL initially (proposed). Implement atomic claim and bounded recovery. Route handlers and MCP tools delegate to services. A proposed separate `packages/runner` owns provider adapters and isolated workspaces; it must not import server internals or make business status decisions.

Flow: Start transaction validates permission/readiness/version -> records queued run and outbox -> dispatcher makes work available -> eligible runner claims -> workspace created/resumed -> adapter invoked -> typed events returned -> services update thread/state.

Exit: AC-03/06/07/08/16. Test concurrent claims, lost acknowledgments, expired leases, cancelled runs and replayed messages, not just happy-path calls.

## Phase 4 — questions and continuation

Persist questions and answers with responder authorization. Add thread and Needs your attention UI. Explicit Answer creates one continuation; a plain comment does not. Support cancelled/superseded questions and scope-change routing.

Exit: AC-04/05/09/16; prove the user can reload or answer twice without duplicate execution. Validate real provider pause/resume or checkpoint/restart from phase 0.

## Phase 5 — delivery and human acceptance

Store branch/PR/commit and evidence with run/context attribution. Reuse an existing PR on retries. Separate runner success, task submission, acceptance and merge. Acceptance checks submitted commit/context and permission before recomputing overview.

Exit: AC-10/11/12/17/18, plus one end-to-end real task from Start through question/answer to PR and acceptance. Automated provider fakes cover deterministic recovery; a manually authorized provider smoke test establishes real integration compatibility.

## Likely repository touchpoints

| Existing path | Intended extension |
| --- | --- |
| packages/core/src/db/schema | Tasks, employees, runs, questions, manifests, receipts |
| packages/core/src/db/migrations | Generated additive migrations and compatibility defaults |
| packages/core/src/domain | Pure transitions/aggregation (inspect exact files first) |
| packages/core/src/services | Permissions, transactions, attribution, durable workflow |
| packages/core/src/http/routes | Thin HTTP transport |
| packages/core/src/mcp/tools | Equivalent scoped operations |
| packages/shared/src | Validated shared request/response/event schemas |
| packages/admin/src | Kanban, profiles, thread, attention and settings views |
| packages/docs | Reuse document/rendering capabilities; avoid unnecessary rewrite |
| e2e | User-visible assignment, answering, acceptance and overview flows |

All new paths and entity names are proposals; inspect current project patterns before choosing final filenames. Existing CLAUDE.md coding/testing rules continue to apply.

## Suggested implementation issue breakdown

1. Provider capability spike and architecture decisions (blocks runner work).
2. Task model, Kanban and cell aggregation.
3. Named employee profiles, attribution and pinned context.
4. Durable claims, run API and scoped runner enrollment.
5. First provider adapter and workspace isolation.
6. Questions, continuation and attention inbox.
7. Artifact submission, human acceptance and overview integration.
8. End-to-end verification and user documentation.

Each issue must reference the relevant acceptance IDs, dependencies and actual reviewed contract. Do not create implementation tickets as if unresolved decisions were already approved.

## Verification and release

Follow repository TDD requirements for feature code. Service tests use real PostgreSQL. Run the existing required unit/integration, lint, typecheck, build and E2E gates for code changes, and add changesets when released packages change. This documentation-only bundle has no runtime changes and requires document/link review, not a fabricated claim that application tests passed.

No auto-merge, deployment or release is authorized by this plan. Keep new workflow opt-in; preserve existing manual cells and non-AI usage. Before rollout, prove bounded retries and cancellation, cross-project isolation, and evidence-based acceptance.
