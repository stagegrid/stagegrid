import type { EmployeeRefDto } from '@stagegrid/shared'

import { Badge } from '@/components/ui/badge'

import { ROLE_LABEL } from './meta'

/** Name, role and an AI badge: an employee is never shown as if it were a person. */
export function EmployeeBadge({ employee }: { employee: EmployeeRefDto }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className="bg-muted flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]"
      >
        {employee.avatar ?? employee.displayName.slice(0, 1).toUpperCase()}
      </span>
      <span className="truncate font-medium">{employee.displayName}</span>
      <span className="text-muted-foreground">{ROLE_LABEL[employee.role]}</span>
      <Badge variant="outline" className="h-4 px-1 text-[10px]">
        AI
      </Badge>
    </span>
  )
}
