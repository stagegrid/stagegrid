import {
  DEFAULT_ROLE_STAGES,
  type EmployeeDto,
  type ProjectDto,
  type TeamSettings,
} from '@stagegrid/shared'
import { useState } from 'react'
import { toast } from 'sonner'

import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PROVIDER_LABEL } from '@/features/employees/meta'
import { useEmployees } from '@/features/employees/queries'
import { api, errorMessage } from '@/lib/api'

import { projectPath, useSettingsMutation, useStages } from './queries'

const NONE = 'none'

function EmployeePicker({
  id,
  label,
  role,
  value,
  employees,
  disabled,
  hint,
  onChange,
}: {
  id: string
  label: string
  role: EmployeeDto['role']
  value: string | null
  employees: EmployeeDto[]
  disabled: boolean
  hint?: string
  onChange: (v: string | null) => void
}) {
  const options = employees.filter((e) => e.role === role)
  return (
    <FormField id={id} label={label} hint={hint}>
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Nobody yet</SelectItem>
          {options.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.displayName} · {PROVIDER_LABEL[e.provider]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

function StagePicker({
  id,
  role,
  value,
  stages,
  disabled,
  onChange,
}: {
  id: string
  role: keyof typeof DEFAULT_ROLE_STAGES
  value: string | null
  stages: { id: string; name: string }[]
  disabled: boolean
  onChange: (v: string | null) => void
}) {
  return (
    <FormField id={id} label="Works on stage">
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>The "{DEFAULT_ROLE_STAGES[role]}" stage</SelectItem>
          {stages.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

/**
 * The team an item's work is handed along: Analyst writes the requirements, Dev builds, Reviewer checks
 * the pull request, QA tests. People approve and accept at every step. Everything starts switched off.
 */
export function TeamSection({ project, readOnly }: { project: ProjectDto; readOnly: boolean }) {
  const [team, setTeam] = useState<TeamSettings>(project.team)
  const { data: employees = [] } = useEmployees(project.slug)
  const { data: stages = [] } = useStages(project.slug)
  const save = useSettingsMutation(project.slug, (t: TeamSettings) =>
    api(`${projectPath(project.slug)}/team`, { method: 'PUT', body: { ...t } }),
  )
  const dev = employees.find((e) => e.id === team.dev.employeeId)
  const reviewer = employees.find((e) => e.id === team.reviewer.employeeId)
  const sameAi = dev && reviewer && dev.provider === reviewer.provider

  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-base font-semibold">Team workflow</h2>
        <p className="text-muted-foreground text-sm">
          Hand an item's work along its stages: the Analyst drafts the requirements, a person
          approves them, Dev builds, Reviewer checks the pull request and QA tests. A person accepts
          every stage. With these off, tasks work as before.
        </p>
      </div>
      <form
        className="grid max-w-xl gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(team, { onError: (err) => toast.error(errorMessage(err)) })
        }}
      >
        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Analyst</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={team.analyst.enabled}
              disabled={readOnly}
              onCheckedChange={(v) =>
                setTeam({ ...team, analyst: { ...team.analyst, enabled: v === true } })
              }
            />
            Draft requirement documents before Dev starts
          </label>
          {team.analyst.enabled && (
            <>
              <EmployeePicker
                id="team-analyst"
                label="Who"
                role="analyst"
                value={team.analyst.employeeId}
                employees={employees}
                disabled={readOnly}
                onChange={(employeeId) =>
                  setTeam({ ...team, analyst: { ...team.analyst, employeeId } })
                }
              />
              <StagePicker
                id="team-analyst-stage"
                role="analyst"
                value={team.analyst.stageId}
                stages={stages}
                disabled={readOnly}
                onChange={(stageId) => setTeam({ ...team, analyst: { ...team.analyst, stageId } })}
              />
              <p className="text-muted-foreground text-xs">
                Dev work then needs a person to approve the exact requirement version it builds
                from.
              </p>
            </>
          )}
        </fieldset>

        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Dev</legend>
          <EmployeePicker
            id="team-dev"
            label="Who"
            role="dev"
            value={team.dev.employeeId}
            employees={employees}
            disabled={readOnly}
            onChange={(employeeId) => setTeam({ ...team, dev: { ...team.dev, employeeId } })}
          />
          <StagePicker
            id="team-dev-stage"
            role="dev"
            value={team.dev.stageId}
            stages={stages}
            disabled={readOnly}
            onChange={(stageId) => setTeam({ ...team, dev: { ...team.dev, stageId } })}
          />
        </fieldset>

        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Reviewer</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={team.reviewer.enabled}
              disabled={readOnly}
              onCheckedChange={(v) =>
                setTeam({ ...team, reviewer: { ...team.reviewer, enabled: v === true } })
              }
            />
            Review Dev's work before it reaches you
          </label>
          {team.reviewer.enabled && (
            <>
              <EmployeePicker
                id="team-reviewer"
                label="Who"
                role="reviewer"
                value={team.reviewer.employeeId}
                employees={employees}
                disabled={readOnly}
                hint="A reviewer on a different AI than Dev tends to catch more."
                onChange={(employeeId) =>
                  setTeam({ ...team, reviewer: { ...team.reviewer, employeeId } })
                }
              />
              {sameAi && (
                <p role="status" className="text-muted-foreground text-xs">
                  Dev and Reviewer both run on {PROVIDER_LABEL[dev.provider]}.
                </p>
              )}
            </>
          )}
        </fieldset>

        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">QA</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={team.qa.enabled}
              disabled={readOnly}
              onCheckedChange={(v) => setTeam({ ...team, qa: { ...team.qa, enabled: v === true } })}
            />
            Test accepted work against the acceptance criteria
          </label>
          {team.qa.enabled && (
            <>
              <EmployeePicker
                id="team-qa"
                label="Who"
                role="qa"
                value={team.qa.employeeId}
                employees={employees}
                disabled={readOnly}
                onChange={(employeeId) => setTeam({ ...team, qa: { ...team.qa, employeeId } })}
              />
              <StagePicker
                id="team-qa-stage"
                role="qa"
                value={team.qa.stageId}
                stages={stages}
                disabled={readOnly}
                onChange={(stageId) => setTeam({ ...team, qa: { ...team.qa, stageId } })}
              />
            </>
          )}
        </fieldset>

        <FormField
          id="team-rework"
          label="Rework rounds"
          hint="How many times a Reviewer or QA can send work back on their own before a person decides."
        >
          <Input
            id="team-rework"
            type="number"
            min={0}
            max={10}
            className="w-24"
            value={team.reworkLimit}
            disabled={readOnly}
            onChange={(e) =>
              setTeam({
                ...team,
                reworkLimit: Math.min(10, Math.max(0, Math.round(Number(e.target.value) || 0))),
              })
            }
          />
        </FormField>
        {!readOnly && (
          <Button type="submit" size="sm" className="justify-self-start" disabled={save.isPending}>
            Save team
          </Button>
        )}
      </form>
    </section>
  )
}
