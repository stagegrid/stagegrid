import { Link, useNavigate } from '@tanstack/react-router'
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  EllipsisIcon,
  LayoutGridIcon,
  PlusIcon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { ErrorState } from '@/components/page-state'
import { ProjectTabs } from '@/components/project-tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useBoard } from '@/features/board/queries'
import { STATUS_META } from '@/features/board/status'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

import { AddReleaseItemsDialog } from './AddReleaseItemsDialog'
import { PhasesDialog } from './PhasesDialog'
import { useRelease, useReleaseMutations } from './queries'
import { Schedule } from './Schedule'
import { RELEASE_BADGE, untilTarget } from './status'

const onError = (e: unknown) => toast.error(errorMessage(e))

export function ReleaseDetailPage({ slug, releaseId }: { slug: string; releaseId: string }) {
  const { data: r, isLoading, error, refetch } = useRelease(slug, releaseId)
  const { data: board } = useBoard(slug)
  const m = useReleaseMutations(slug, releaseId)
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<
    null | 'phases' | 'items' | 'edit' | 'release' | 'cancel' | 'delete'
  >(null)
  const [edit, setEdit] = useState({ name: '', targetDate: '', description: '' })

  if (isLoading) return <Skeleton className="m-6 h-96" />
  if (error || !r) return <ErrorState error={error} onRetry={() => void refetch()} />
  const canEdit = r.project.role !== 'viewer' && r.status === 'active'
  const isOwner = r.project.role === 'owner'
  const badge = RELEASE_BADGE[r.displayStatus]
  const inRelease = new Set(r.scope.filter((i) => i.kind).map((i) => i.id))

  const stat = (label: string, value: React.ReactNode, sub: React.ReactNode) => (
    <div className="bg-muted/50 rounded-lg p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs">{sub}</p>
    </div>
  )

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon-sm" asChild aria-label="All releases">
          <Link to="/p/$slug/releases" params={{ slug }}>
            <ArrowLeftIcon />
          </Link>
        </Button>
        <h1 className="truncate text-base font-semibold" title={r.name}>
          {r.name}
        </h1>
        <span className={cn('rounded px-2 py-0.5 text-xs font-medium', badge.className)}>
          {badge.label}
        </span>
        <ProjectTabs slug={slug} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {r.status === 'active' && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/p/$slug" params={{ slug }} search={{ release: r.id }}>
                <LayoutGridIcon />
                Open in board
              </Link>
            </Button>
          )}
          {isOwner && r.status === 'active' && (
            <Button size="sm" onClick={() => setDialog('release')}>
              Mark released
            </Button>
          )}
          {(canEdit || isOwner) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Release actions">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {r.project.role !== 'viewer' && (
                  <DropdownMenuItem
                    onClick={() => {
                      setEdit({
                        name: r.name,
                        targetDate: r.targetDate,
                        description: r.description,
                      })
                      setDialog('edit')
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                )}
                {isOwner && r.status === 'active' && (
                  <DropdownMenuItem onClick={() => setDialog('cancel')}>
                    Cancel release
                  </DropdownMenuItem>
                )}
                {isOwner && (
                  <DropdownMenuItem variant="destructive" onClick={() => setDialog('delete')}>
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="grid gap-6 p-6">
        {r.description && (
          <p className="text-muted-foreground max-w-3xl text-sm">{r.description}</p>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stat(
            'Target',
            r.targetDate,
            r.status === 'released'
              ? `Released ${r.releasedAt?.slice(0, 10)}`
              : untilTarget(r.today, r.targetDate),
          )}
          {stat('Progress', `${r.stats.percent}%`, `${r.stats.done} of ${r.stats.all} cells`)}
          {stat(
            'Scope',
            `${r.itemCount.new + r.itemCount.change} items`,
            `${r.itemCount.new} new · ${r.itemCount.change} changed`,
          )}
          {stat(
            'Risks',
            <span className={cn(r.riskCount > 0 && 'text-status-doing')}>{r.riskCount}</span>,
            r.riskCount ? 'see below' : 'none',
          )}
        </div>

        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-muted-foreground text-xs font-medium uppercase">Schedule</h2>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setDialog('phases')}>
                Edit phases
              </Button>
            )}
          </div>
          <Schedule phases={r.phases} targetDate={r.targetDate} today={r.today} />
        </section>

        {r.risks.length > 0 && (
          <section
            aria-label="Risks"
            className="border-status-doing bg-status-doing/10 grid gap-1 border-l-4 p-3 text-sm"
          >
            {r.risks.map((x, i) => (
              <p key={i} className="flex items-start gap-2">
                <AlertTriangleIcon className="text-status-doing mt-0.5 size-4 shrink-0" />
                {x.message}
              </p>
            ))}
          </section>
        )}

        {r.status === 'released' && r.snapshot ? (
          <section className="grid gap-2">
            <h2 className="text-muted-foreground text-xs font-medium uppercase">What shipped</h2>
            <table className="text-sm">
              <tbody>
                {r.snapshot.items.map((i) => (
                  <tr key={i.path} className="border-b">
                    <td className="py-1.5 pr-3">{i.path}</td>
                    <td className="pr-3 text-xs capitalize">{i.kind}</td>
                    <td className="text-muted-foreground text-xs">
                      {i.cells.map((c) => `${c.stage}: ${STATUS_META[c.status].label}`).join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-muted-foreground text-xs font-medium uppercase">Scope</h2>
              {canEdit && board && (
                <Button variant="outline" size="sm" onClick={() => setDialog('items')}>
                  <PlusIcon />
                  Add items
                </Button>
              )}
            </div>
            {r.scope.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No items yet. Add the menus that are new or changed in this release.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" aria-label="Release scope">
                  <thead>
                    <tr className="text-muted-foreground text-xs">
                      <th className="py-1 text-left font-medium">Item</th>
                      <th className="px-2 text-left font-medium">Type</th>
                      {r.stages.map((s) => (
                        <th key={s.id} className="px-1 font-medium">
                          {s.name}
                        </th>
                      ))}
                      <th className="px-2 text-right font-medium">Done</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {r.scope.map((i) => {
                      const cells = Object.values(i.cells).filter((c) => c.status !== 'skip')
                      const pct = cells.length
                        ? Math.round(
                            (cells.filter((c) => c.status === 'done').length / cells.length) * 100,
                          )
                        : null
                      return (
                        <tr
                          key={i.id}
                          className={cn('border-b', !i.kind && 'text-muted-foreground')}
                        >
                          <td className="py-1.5" style={{ paddingLeft: i.depth * 16 }}>
                            {i.name}
                            {i.note && (
                              <span className="text-muted-foreground ml-2 text-xs">— {i.note}</span>
                            )}
                          </td>
                          <td className="px-2">
                            {i.kind && (
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-[11px] font-medium',
                                  i.kind === 'new'
                                    ? 'bg-primary/15 text-primary'
                                    : 'bg-accent text-accent-foreground',
                                )}
                              >
                                {i.kind === 'new' ? 'New' : 'Change'}
                              </span>
                            )}
                          </td>
                          {r.stages.map((s) => {
                            const c = i.cells[s.id]
                            return (
                              <td key={s.id} className="px-1 text-center">
                                {c ? (
                                  <span
                                    className={cn(
                                      'inline-block h-3.5 w-full min-w-6 rounded-[3px]',
                                      STATUS_META[c.status].cell,
                                    )}
                                    title={`${s.name}: ${STATUS_META[c.status].label}`}
                                  />
                                ) : i.kind ? (
                                  <span className="text-muted-foreground text-xs">–</span>
                                ) : null}
                              </td>
                            )
                          })}
                          <td className="px-2 text-right text-xs tabular-nums">
                            {pct === null ? '' : `${pct}%`}
                          </td>
                          <td className="w-8">
                            {canEdit && i.kind && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Actions for ${i.name}`}
                                  >
                                    <EllipsisIcon />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      const note = prompt('Note', i.note ?? '')
                                      if (note !== null)
                                        m.setNote.mutate(
                                          { itemId: i.id, note: note.trim() || null },
                                          { onError },
                                        )
                                    }}
                                  >
                                    Edit note
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => m.removeItem.mutate(i.id, { onError })}
                                  >
                                    Remove from release
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="text-muted-foreground mt-1 text-xs">
                  – = stage not part of this release · dimmed rows are shown for context
                </p>
              </div>
            )}
          </section>
        )}
      </div>

      {dialog === 'phases' && (
        <PhasesDialog
          phases={r.phases}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onSave={(p) => m.setPhases.mutateAsync(p)}
        />
      )}
      {dialog === 'items' && board && (
        <AddReleaseItemsDialog
          board={board}
          inRelease={inRelease}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          mutations={m}
        />
      )}
      <Dialog open={dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit release</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              aria-label="Name"
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
            <Input
              aria-label="Target date"
              type="date"
              value={edit.targetDate}
              disabled={r.status !== 'active'}
              onChange={(e) => setEdit({ ...edit, targetDate: e.target.value })}
            />
            <Textarea
              aria-label="Description"
              rows={3}
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                m.update.mutate(
                  {
                    name: edit.name.trim(),
                    description: edit.description,
                    ...(r.status === 'active' ? { targetDate: edit.targetDate } : {}),
                  },
                  { onError, onSuccess: () => setDialog(null) },
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={dialog === 'release' || dialog === 'cancel' || dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === 'release'
                ? `Mark ${r.name} as released?`
                : dialog === 'cancel'
                  ? `Cancel ${r.name}?`
                  : `Delete ${r.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === 'release'
                ? r.stats.open > 0
                  ? `${r.stats.open} cell${r.stats.open === 1 ? " isn't" : "s aren't"} done. Release anyway? The scope is saved as a snapshot and locked.`
                  : 'The scope is saved as a snapshot and locked.'
                : dialog === 'cancel'
                  ? "It stays in the list as cancelled. Cells aren't changed."
                  : "It disappears from the list. Cells aren't changed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (dialog === 'release') m.release.mutate(r.stats.open > 0, { onError })
                else if (dialog === 'cancel') m.cancel.mutate(undefined, { onError })
                else
                  m.remove.mutate(undefined, {
                    onError,
                    onSuccess: () => void navigate({ to: '/p/$slug/releases', params: { slug } }),
                  })
              }}
            >
              {dialog === 'release'
                ? 'Mark released'
                : dialog === 'cancel'
                  ? 'Cancel release'
                  : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
