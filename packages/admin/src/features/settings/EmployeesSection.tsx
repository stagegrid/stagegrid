import {
  EMPLOYEE_PROVIDERS,
  EMPLOYEE_ROLES,
  type EmployeeDto,
  type EmployeeProvider,
  type EmployeeRole,
} from '@stagegrid/shared'
import { useState } from 'react'
import { toast } from 'sonner'

import { FormField } from '@/components/form-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PROVIDER_LABEL, ROLE_LABEL } from '@/features/employees/meta'
import { useEmployeeMutations, useEmployees } from '@/features/employees/queries'
import { errorMessage } from '@/lib/api'

interface Draft {
  displayName: string
  role: EmployeeRole
  provider: EmployeeProvider
  model: string
  avatar: string
  instructions: string
}

const EMPTY: Draft = {
  displayName: '',
  role: 'dev',
  provider: 'claude_code',
  model: '',
  avatar: '',
  instructions: '',
}

function EmployeeDialog({
  slug,
  editing,
  open,
  onClose,
}: {
  slug: string
  editing: EmployeeDto | null
  open: boolean
  onClose: () => void
}) {
  const { create, update } = useEmployeeMutations(slug)
  const [draft, setDraft] = useState<Draft>(
    editing
      ? {
          displayName: editing.displayName,
          role: editing.role,
          provider: editing.provider,
          model: editing.model ?? '',
          avatar: editing.avatar ?? '',
          instructions: editing.instructions,
        }
      : EMPTY,
  )
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const submit = () => {
    const body = {
      displayName: draft.displayName.trim(),
      role: draft.role,
      provider: draft.provider,
      model: draft.model.trim() || null,
      avatar: draft.avatar.trim() || null,
      instructions: draft.instructions.trim(),
    }
    const opts = { onSuccess: onClose, onError: (e: unknown) => toast.error(errorMessage(e)) }
    if (editing) update.mutate({ id: editing.id, expectedVersion: editing.version, ...body }, opts)
    else create.mutate(body, opts)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.displayName}` : 'New AI employee'}</DialogTitle>
          <DialogDescription>
            Changes to the runtime apply to the next run. Work already done keeps its history.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
            <FormField id="emp-name" label="Name">
              <Input
                id="emp-name"
                value={draft.displayName}
                maxLength={60}
                onChange={(e) => set('displayName', e.target.value)}
              />
            </FormField>
            <FormField id="emp-avatar" label="Avatar" hint="Emoji">
              <Input
                id="emp-avatar"
                value={draft.avatar}
                maxLength={8}
                onChange={(e) => set('avatar', e.target.value)}
              />
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="emp-role" label="Role">
              <Select value={draft.role} onValueChange={(v) => set('role', v as EmployeeRole)}>
                <SelectTrigger id="emp-role" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="emp-provider" label="Runs on">
              <Select
                value={draft.provider}
                onValueChange={(v) => set('provider', v as EmployeeProvider)}
              >
                <SelectTrigger id="emp-provider" className="w-full min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField
            id="emp-model"
            label="Model"
            hint="Optional. Leave empty for the runtime's default"
          >
            <Input
              id="emp-model"
              value={draft.model}
              maxLength={100}
              onChange={(e) => set('model', e.target.value)}
            />
          </FormField>
          <FormField
            id="emp-instructions"
            label="Instructions"
            hint="Optional. How this employee should work"
          >
            <Textarea
              id="emp-instructions"
              rows={4}
              value={draft.instructions}
              onChange={(e) => set('instructions', e.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!draft.displayName.trim() || create.isPending || update.isPending}
            >
              {editing ? 'Save' : 'Create employee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EmployeesSection({ slug, readOnly }: { slug: string; readOnly: boolean }) {
  const [showArchived, setShowArchived] = useState(false)
  const { data: employees = [] } = useEmployees(slug, showArchived)
  const { setArchived } = useEmployeeMutations(slug)
  const [dialog, setDialog] = useState<{ editing: EmployeeDto | null } | null>(null)
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-base font-semibold">AI employees</h2>
        <p className="text-muted-foreground text-sm">
          Named employees that take tasks on this project. Each has a role and runs on Claude Code
          or Codex.
        </p>
      </div>
      {employees.length === 0 && (
        <p className="text-muted-foreground text-sm">No AI employees yet.</p>
      )}
      <ul className="grid max-w-xl divide-y rounded-lg border empty:hidden">
        {employees.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-3 py-2">
            <span
              aria-hidden
              className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full"
            >
              {e.avatar ?? e.displayName.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm">
                <span className="truncate font-medium" title={e.displayName}>
                  {e.displayName}
                </span>
                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                  AI
                </Badge>
                {e.archivedAt && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    Archived
                  </Badge>
                )}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {ROLE_LABEL[e.role]} · {PROVIDER_LABEL[e.provider]}
                {e.model ? ` · ${e.model}` : ''}
              </p>
            </div>
            {!readOnly && (
              <>
                {!e.archivedAt && (
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ editing: e })}>
                    Edit
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={setArchived.isPending}
                  onClick={() =>
                    setArchived.mutate(
                      { id: e.id, archived: !e.archivedAt },
                      { onError: (err) => toast.error(errorMessage(err)) },
                    )
                  }
                >
                  {e.archivedAt ? 'Restore' : 'Archive'}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {!readOnly && (
          <Button size="sm" onClick={() => setDialog({ editing: null })}>
            New employee
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Button>
      </div>
      {dialog && (
        <EmployeeDialog
          key={dialog.editing?.id ?? 'new'}
          slug={slug}
          editing={dialog.editing}
          open
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  )
}
