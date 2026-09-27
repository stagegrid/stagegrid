import { zonedDate } from '@stagegrid/shared'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { FormField } from '@/components/form-field'
import { EmptyState, ErrorState } from '@/components/page-state'
import { ProgressBar } from '@/components/progress-bar'
import { ProjectTabs } from '@/components/project-tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useProject } from '@/features/settings/queries'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

import { useCreateRelease, useReleases } from './queries'
import { RELEASE_BADGE, untilTarget } from './status'

export function ReleasesPage({ slug }: { slug: string }) {
  const { data: project } = useProject(slug)
  const { data: releases, isLoading, error, refetch } = useReleases(slug)
  const [creating, setCreating] = useState(false)
  const canEdit = project && project.role !== 'viewer'
  const today = project ? zonedDate(new Date(), project.timezone) : ''

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <h1 className="truncate text-base font-semibold">{project?.name ?? '…'}</h1>
        <ProjectTabs slug={slug} />
        {canEdit && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
            <PlusIcon />
            Create release
          </Button>
        )}
      </div>
      <div className="p-6">
        {isLoading && <Skeleton className="h-40" />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {releases?.length === 0 && (
          <EmptyState
            title="Plan your first release"
            body="A release has a go-live date, phases such as SIT and UAT, and the menus that are new or changed in it."
            action={canEdit && <Button onClick={() => setCreating(true)}>Create release</Button>}
          />
        )}
        {releases && releases.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {releases.map((r) => {
              const badge = RELEASE_BADGE[r.displayStatus]
              return (
                <Link
                  key={r.id}
                  to="/p/$slug/releases/$releaseId"
                  params={{ slug, releaseId: r.id }}
                  className="rounded-xl focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Card
                    className={cn(
                      'hover:border-primary/50 h-full transition-colors',
                      r.displayStatus === 'at_risk' && 'border-status-doing/60',
                    )}
                  >
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-2">
                        <span className="truncate" title={r.name}>
                          {r.name}
                        </span>
                        <span
                          className={cn('rounded px-2 py-0.5 text-xs font-medium', badge.className)}
                        >
                          {badge.label}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2 text-sm">
                      <p className="text-muted-foreground">
                        {r.status === 'released' && r.releasedAt
                          ? `Released ${r.releasedAt.slice(0, 10)}`
                          : `Target ${r.targetDate} · ${untilTarget(today, r.targetDate)}`}
                      </p>
                      <ProgressBar percent={r.stats.percent} />
                      <p className="text-muted-foreground text-xs">
                        {r.stats.percent}% · {r.itemCount.new} new · {r.itemCount.change} changed
                        {r.riskCount > 0 && ` · ${r.riskCount} risk${r.riskCount === 1 ? '' : 's'}`}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
      <CreateReleaseDialog slug={slug} open={creating} onOpenChange={setCreating} />
    </div>
  )
}

function CreateReleaseDialog({
  slug,
  open,
  onOpenChange,
}: {
  slug: string
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const create = useCreateRelease(slug)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [description, setDescription] = useState('')
  const submit = async () => {
    try {
      const r = await create.mutateAsync({ name: name.trim(), targetDate, description })
      onOpenChange(false)
      setName('')
      setTargetDate('')
      setDescription('')
      await navigate({ to: '/p/$slug/releases/$releaseId', params: { slug, releaseId: r.id } })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create release</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField id="release-name" label="Name">
            <Input
              id="release-name"
              placeholder="v1.2 – Go-live phase 2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </FormField>
          <FormField id="release-target" label="Target date (go-live)">
            <Input
              id="release-target"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </FormField>
          <FormField id="release-description" label="Description">
            <Textarea
              id="release-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </FormField>
          <p className="text-muted-foreground text-xs">
            Phases start from the project's defaults (Settings → Releases). You can change them
            later.
          </p>
        </div>
        <DialogFooter>
          <Button
            onClick={() => void submit()}
            disabled={!name.trim() || !targetDate || create.isPending}
          >
            Create release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
