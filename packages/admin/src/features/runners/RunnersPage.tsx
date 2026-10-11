import { DEFAULT_CEILINGS, type RunnerDto, type RunnerEnrollmentDto } from '@stagegrid/shared'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { CopyField } from '@/components/copy-field'
import { FormField } from '@/components/form-field'
import { EmptyState, ErrorState, PageHeader } from '@/components/page-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PROVIDER_LABEL } from '@/features/employees/meta'
import { errorMessage } from '@/lib/api'
import { relativeTime } from '@/lib/format'

import { allProjectsQuery, useRunnerMutations, useRunners } from './queries'
import { UsageBar } from './UsageBar'

function AddRunnerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: projects = [] } = useQuery(allProjectsQuery)
  const { enroll } = useRunnerMutations()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [issued, setIssued] = useState<RunnerEnrollmentDto | null>(null)
  const close = () => {
    setIssued(null)
    setName('')
    setPicked([])
    onClose()
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{issued ? 'Enroll the runner' : 'Add a runner'}</DialogTitle>
          <DialogDescription>
            {issued
              ? 'Run this on the machine. The token works once and expires in an hour; it is not shown again.'
              : 'A runner is a machine that does the work. It gets its own credential, limited to the projects you pick, and you can revoke it any time.'}
          </DialogDescription>
        </DialogHeader>
        {issued ? (
          <div className="grid gap-3">
            <CopyField
              label="Enrollment command"
              multiline
              value={`stagegrid-runner enroll --url ${window.location.origin} --token ${issued.token}`}
            />
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              enroll.mutate(
                { name: name.trim(), projectIds: picked },
                { onSuccess: setIssued, onError: (err) => toast.error(errorMessage(err)) },
              )
            }}
          >
            <FormField id="runner-name" label="Name" hint="For example the machine's name">
              <Input
                id="runner-name"
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <fieldset className="grid gap-1.5">
              <legend className="text-sm font-medium">Projects it can work on</legend>
              <div className="grid max-h-40 gap-1.5 overflow-y-auto">
                {projects.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={picked.includes(p.id)}
                      onCheckedChange={() =>
                        setPicked((l) =>
                          l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id],
                        )
                      }
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || picked.length === 0 || enroll.isPending}
              >
                Create token
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LimitsDialog({ runner, onClose }: { runner: RunnerDto; onClose: () => void }) {
  const { update } = useRunnerMutations()
  const [maxConcurrent, setMax] = useState(String(runner.maxConcurrent))
  const [limits, setLimits] = useState(() =>
    Object.fromEntries(
      runner.providers.map((p) => [
        p,
        {
          fiveHour: String(runner.ceilings[p]?.fiveHour ?? DEFAULT_CEILINGS.fiveHour),
          weekly: String(runner.ceilings[p]?.weekly ?? DEFAULT_CEILINGS.weekly),
        },
      ]),
    ),
  )
  const num = (s: string) => Math.min(100, Math.max(1, Math.round(Number(s) || 0)))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Limits for {runner.name}</DialogTitle>
          <DialogDescription>
            Above a ceiling, new runs wait in the queue and start by themselves when usage drops or
            resets. Work already running is not stopped. Use 100 for an account only AI uses.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            update.mutate(
              {
                id: runner.id,
                maxConcurrent: num(maxConcurrent),
                ceilings: Object.fromEntries(
                  Object.entries(limits).map(([p, v]) => [
                    p,
                    { fiveHour: num(v.fiveHour), weekly: num(v.weekly) },
                  ]),
                ),
              },
              { onSuccess: onClose, onError: (err) => toast.error(errorMessage(err)) },
            )
          }}
        >
          <FormField id="limit-concurrent" label="Runs at the same time">
            <Input
              id="limit-concurrent"
              type="number"
              min={1}
              max={20}
              value={maxConcurrent}
              onChange={(e) => setMax(e.target.value)}
            />
          </FormField>
          {Object.entries(limits).map(([provider, v]) => (
            <fieldset key={provider} className="grid gap-2">
              <legend className="text-sm font-medium">
                {PROVIDER_LABEL[provider as keyof typeof PROVIDER_LABEL] ?? provider}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <FormField id={`${provider}-5h`} label="5-hour window, %">
                  <Input
                    id={`${provider}-5h`}
                    type="number"
                    min={1}
                    max={100}
                    value={v.fiveHour}
                    onChange={(e) =>
                      setLimits((l) => ({ ...l, [provider]: { ...v, fiveHour: e.target.value } }))
                    }
                  />
                </FormField>
                <FormField id={`${provider}-week`} label="Weekly window, %">
                  <Input
                    id={`${provider}-week`}
                    type="number"
                    min={1}
                    max={100}
                    value={v.weekly}
                    onChange={(e) =>
                      setLimits((l) => ({ ...l, [provider]: { ...v, weekly: e.target.value } }))
                    }
                  />
                </FormField>
              </div>
            </fieldset>
          ))}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RunnerCard({
  runner,
  projectNames,
}: {
  runner: RunnerDto
  projectNames: Map<string, string>
}) {
  const { revoke } = useRunnerMutations()
  const [limits, setLimits] = useState(false)
  const revoked = runner.revokedAt !== null
  return (
    <li className="grid gap-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold">{runner.name}</h2>
        <Badge variant={runner.online ? 'secondary' : 'outline'}>
          {revoked ? 'Revoked' : runner.online ? 'Online' : 'Offline'}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {runner.lastSeenAt ? `Seen ${relativeTime(runner.lastSeenAt)}` : 'Never seen'}
        </span>
        {!revoked && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setLimits(true)}>
              Limits
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() => {
                if (window.confirm(`Revoke ${runner.name}? It stops working at once.`))
                  revoke.mutate(runner.id, { onError: (e) => toast.error(errorMessage(e)) })
              }}
            >
              Revoke
            </Button>
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        {runner.projectIds.map((id) => projectNames.get(id) ?? 'Unknown project').join(', ')} ·{' '}
        {runner.maxConcurrent} at a time
        {runner.version ? ` · v${runner.version}` : ''}
      </p>
      {runner.providers.length === 0 && (
        <p className="text-muted-foreground text-xs">
          No AI tool reported yet. Install Claude Code or Codex on the machine, then run the runner.
        </p>
      )}
      {runner.providers.map((p) => {
        const cap = runner.capacity[p]
        const c = runner.ceilings[p] ?? DEFAULT_CEILINGS
        return (
          <div key={p} className="grid gap-2">
            <p className="text-sm">{PROVIDER_LABEL[p as keyof typeof PROVIDER_LABEL] ?? p}</p>
            <UsageBar
              label="5-hour"
              percent={cap?.fiveHour?.percent ?? null}
              ceiling={c.fiveHour}
              resetsAt={cap?.fiveHour?.resetsAt ?? null}
            />
            <UsageBar
              label="Weekly"
              percent={cap?.weekly?.percent ?? null}
              ceiling={c.weekly}
              resetsAt={cap?.weekly?.resetsAt ?? null}
            />
          </div>
        )
      })}
      {limits && <LimitsDialog runner={runner} onClose={() => setLimits(false)} />}
    </li>
  )
}

export function RunnersPage() {
  const { data: runners, isLoading, error, refetch } = useRunners()
  const { data: projects = [] } = useQuery(allProjectsQuery)
  const [adding, setAdding] = useState(false)
  const names = new Map(projects.map((p) => [p.id, p.name]))
  return (
    <div>
      <PageHeader
        title="Runners"
        description="Machines that do the AI employees' work, and how much of each AI account they may use."
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add runner
          </Button>
        }
      />
      <div className="p-6">
        {isLoading && <Skeleton className="h-40" />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {runners?.length === 0 && (
          <EmptyState
            title="No runners yet"
            body="Employees need a runner to work. Add one, then run the enrollment command on the machine that has Claude Code or Codex."
            action={<Button onClick={() => setAdding(true)}>Add runner</Button>}
          />
        )}
        {runners && runners.length > 0 && (
          <ul className="grid max-w-3xl gap-3">
            {runners.map((r) => (
              <RunnerCard key={r.id} runner={r} projectNames={names} />
            ))}
          </ul>
        )}
      </div>
      <AddRunnerDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
