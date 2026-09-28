# @stagegrid/core

## 0.1.0

### Minor Changes

- 5d192de: First release: self-hosted board of items × stages with live updates, setup/invite flow, projects, stages, item tree, cell status history with backdating, JSON/CSV export, and `npx create-stagegrid`.
- a0ab22b: MCP support: personal access tokens, a `/mcp` endpoint with 13 tools, the Stagegrid guide as MCP prompts/resources, a downloadable AI skill, the `@stagegrid/mcp` stdio bridge, and a Connect AI dialog.
- b920a17: Cell details: assignees (users or free-text names), planned dates with past-due "needs update", links, markdown comments, and history corrections — in the web popover, REST, and MCP (`apply_changes` fields and `edit_event`). The board shows comment/document icons, assignee avatars, and an assignee filter.
- 3a5839a: Timeline view: Gantt of planned dates versus actual work rounds per item and stage, with overdue highlighting; burn-up chart and board sparkline.
- d922546: Releases: go-live target dates, phases such as SIT and UAT, scope of new and changed items (changed stages are reopened), computed risks, snapshots on release; board and timeline integration and MCP release tools.
- 37134a5: OAuth 2.1 for the MCP endpoint: claude.ai, ChatGPT, and other apps with sign-in can connect with a consent screen; connected apps are listed in Profile.
- 8ee9c17: Documents: seven built-in templates (BRD, SRS, MOM, release notes, change request, UAT sign-off, test summary) plus your own; your AI writes drafts over MCP; view, edit, and version them in Docs; download Word (with your company's base .docx), Markdown, Print/PDF, or copy for Confluence.

### Patch Changes

- 810dc9d: Packaging fixes before the first npm release: `@stagegrid/mcp` now ships its CLI, `create-stagegrid` pins new projects to its own release version, both CLIs answer `--help`, and each package has a README and repository links.
