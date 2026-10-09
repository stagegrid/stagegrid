# Stagegrid: agent entry point

Read [CLAUDE.md](CLAUDE.md) for existing repository layout, coding rules and required verification. That file remains the single source of coding conventions; this entry point adds feature-document navigation. Read each once; do not follow the cross-links recursively.

## AI employees and SDLC work

Read in order:

1. [RFC](docs/rfcs/ai-employees.md): agreed product direction, roadmap and alternatives.
2. [MVP spec](docs/features/ai-employees/spec.md): behavior, state transitions, acceptance scenarios and open decisions.
3. [API contract](docs/features/ai-employees/api-contract.md): proposed transport and event semantics.
4. [Implementation plan](docs/features/ai-employees/implementation-plan.md): dependency order and verification.

These are draft design documents, not implementation evidence. The product direction came from the maintainer discussion; proposed technical defaults still need review. Prior chat history is not necessary and must not be invented.

Before implementation, summarize the requested slice, acceptance IDs and relevant unresolved decisions; inspect current source and resolve blockers. Do not implement every roadmap item at once. Only change scope explicitly authorized for the task.

Distinguish employee identity from provider/session; run success from human acceptance; requirements approval from implementation readiness; and comments/mentions from explicit work dispatch. Never read mutable latest docs as a substitute for the pinned approved context.

When an issue discussion changes an agreed requirement, update the relevant canonical feature document and record decision status. Report contradictions instead of choosing silently. The spec owns MVP behavior; the RFC owns broad intent. If they conflict, flag it for a decision and align both.

Work on the branch containing these documents until merged. A reader on main will not see draft-branch documents. Do not claim an issue, PR, merge, test or feature exists without evidence.
