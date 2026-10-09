# AI employees: proposed API and event contract

Status: Draft design, not existing endpoints. Read [spec](spec.md) first.

## Principles

Reuse `/api/v1` conventions and existing service authorization. Final route names must be checked against repository patterns before coding. IDs below are opaque stable IDs, never display names. Use ISO timestamps with offsets; use project timezone for user-facing dates.

Human sessions/PATs retain their current auth semantics. Runner enrollment, credential scope and transport need design approval (D-05). A runner must not inherit an unrestricted human token. Resolve employee/run identity from authenticated server records rather than trusting payload identity.

## Candidate operations

All paths below are relative to `/api/v1/projects/{projectId}`.

| Method / path | Input sketch | Outcome |
| --- | --- | --- |
| POST /employees | displayName, role, runtimeProfileId, instructions | Employee record |
| PATCH /employees/{id} | expectedVersion, editable fields | Updated employee; does not mutate existing runs |
| POST /tasks | title, scope, acceptanceCriteria, cellId, employeeId | Draft task |
| POST /tasks/{id}/context-revisions | sources, documentRevisionIds, decisions, repo/baseCommit | Immutable context manifest |
| POST /tasks/{id}/ready | expectedVersion, contextRevisionId | Validated readiness |
| POST /tasks/{id}/start | expectedVersion, contextRevisionId, idempotencyKey | Durable queued run |
| POST /runs/{id}/claim | idempotencyKey | Atomic lease, fencingToken, leaseExpiresAt |
| POST /runs/{id}/heartbeat | fencingToken | Renew eligible lease |
| POST /runs/{id}/events | eventId, sequence, type, payload, fencingToken | Deduplicated durable event receipt |
| POST /runs/{id}/questions | prompt, options?, contextRevisionId, idempotencyKey, fencingToken | Open blocking question |
| POST /questions/{id}/answer | expectedVersion, answer, idempotencyKey | Persisted answer and single continuation |
| POST /runs/{id}/result | artifacts, verification, contextRevisionId, fencingToken, idempotencyKey | Validated submission for human acceptance |
| POST /tasks/{id}/accept | expectedVersion, contextRevisionId, artifactRevision, idempotencyKey | Human acceptance; aggregate progress |
| POST /tasks/{id}/request-changes | expectedVersion, reason, idempotencyKey | Rework requested |
| POST /runs/{id}/cancel | expectedVersion, reason, idempotencyKey | Authority revoked; cancellation requested |
| GET /tasks/{id}/thread | cursor? | Paginated messages/questions/artifacts |
| GET /attention | cursor? | Authorized pending questions/review/failure items |

Runner queue retrieval/long polling is a separate authenticated runner endpoint, scoped by server-side runner grants. Queue retrieval does not grant ownership; claim does. Reuse project realtime streams for UI projections rather than making browsers connect to local machines.

## Result payload sketch

```json
{
  "contextRevisionId": "context-id",
  "fencingToken": 7,
  "idempotencyKey": "run-id:delivery:1",
  "artifacts": [
    {"kind": "pull_request", "url": "https://github.com/OWNER/REPO/pull/123", "headCommit": "commit-sha"}
  ],
  "verification": [
    {"command": "pnpm test", "exitCode": 0, "commit": "commit-sha", "reportRef": "artifact-id"}
  ],
  "summary": "Implemented the agreed behavior; ready for human review."
}
```

Example values are placeholders, not real PRs or existing field definitions. Command output is evidence attributed to a run, not an assertion of independent server verification. Label which evidence was runner-reported versus checked by CI. Validate configured allowed repo/branch and matching commit; do not fetch arbitrary supplied URLs with privileged credentials.

## Errors and concurrency

- 401: missing/expired credentials.
- 403: project/action outside caller authority.
- 404: absent resource or concealment according to existing access conventions.
- 409: stale expectedVersion, claim conflict, cancelled/superseded state, idempotency key reused with different input, or old fencing token.
- 422: incomplete readiness/context/evidence; use existing validation error conventions if they differ.

Mutation responses include current state/version and structured reason codes. Idempotency is scoped to project + operation + caller/run as appropriate. Persist request hash/result; a retry with the same input returns the prior result, while differing input conflicts. Durably record state and dispatch intent together; notification alone is not a durable queue.

## Events and recovery

Proposed event types: run.queued, run.claimed, run.progress, question.opened, question.answered, continuation.queued, result.submitted, acceptance.recorded, run.failed, run.cancelled, run.interrupted.

Every event has schemaVersion, eventId, taskId, runId (where applicable), actor identity, happenedAt and recordedAt. Messages derived from events retain the event/run reference. Deduplicate by eventId and validate per-run order. Reconnect uses a durable cursor; replay must not duplicate business effects.

After lease loss, no new mutations from the old attempt are allowed. A human-approved retry obtains a new fencing token. Persist question answers before scheduling continuation. Cancelled/superseded questions reject late answers; cancelled runs revoke pending continuation. A new attempt references the original task, context, answer and workspace checkpoint.

## MCP parity

Future MCP operations should call the same services and enforce the same authorization, version and idempotency rules. Suggested capabilities: read assigned task/context, post progress, ask question, submit artifacts. Access to administrative starts, acceptance and credential management must not be implicitly granted to Dev employees. Existing apply_changes behavior must report task-managed cell conflicts consistently with HTTP.

## Contract review gate

Before implementing endpoints, confirm D-03/D-05/D-07, exact response schemas, pagination, version fields, role mapping, artifact validation and chosen transport. Add shared Zod schemas only after this draft is reviewed; do not assume examples are deployed APIs.
