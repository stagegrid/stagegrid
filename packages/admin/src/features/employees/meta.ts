import type { EmployeeProvider, EmployeeRole } from '@stagegrid/shared'

export const ROLE_LABEL: Record<EmployeeRole, string> = {
  analyst: 'Analyst',
  dev: 'Dev',
  reviewer: 'Reviewer',
  qa: 'QA',
}

export const PROVIDER_LABEL: Record<EmployeeProvider, string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
}
