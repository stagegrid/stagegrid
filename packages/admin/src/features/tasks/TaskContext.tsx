import type { DocumentSummaryDto, TaskDetailDto } from '@stagegrid/shared'
import { useQuery } from '@tanstack/react-query'
import { TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { FormField } from '@/components/form-field'
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
import { Textarea } from '@/components/ui/textarea'
import { useDocuments } from '@/features/docs/queries'
import { taskContextQuery, usePinContext } from '@/features/employees/queries'
import { errorMessage } from '@/lib/api'

function PinDialog({
  slug,
  taskId,
  documents,
  open,
  onClose,
}: {
  slug: string
  taskId: string
  documents: DocumentSummaryDto[]
  open: boolean
  onClose: () => void
}) {
  const pin = usePinContext(slug, taskId)
  const [docIds, setDocIds] = useState<string[]>([])
  const [decisions, setDecisions] = useState('')
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceText, setSourceText] = useState('')
  const toggle = (id: string) =>
    setDocIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))
  const submit = () =>
    pin.mutate(
      {
        documentIds: docIds,
        decisions: decisions
          .split('\n')
          .map((d) => d.trim())
          .filter(Boolean),
        sources: sourceText.trim()
          ? [
              {
                title: sourceTitle.trim() || 'Source',
                url: sourceUrl.trim() || null,
                content: sourceText.trim(),
              },
            ]
          : [],
      },
      { onSuccess: onClose, onError: (e) => toast.error(errorMessage(e)) },
    )
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pin context</DialogTitle>
          <DialogDescription>
            The employee works from exactly what you pin here. Later edits to a document don't
            change it; pin again to move on.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">Documents</legend>
            {documents.length === 0 && (
              <p className="text-muted-foreground text-xs">No documents in this project yet.</p>
            )}
            <div className="grid max-h-36 gap-1.5 overflow-y-auto">
              {documents.map((d) => (
                <label key={d.id} className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox checked={docIds.includes(d.id)} onCheckedChange={() => toggle(d.id)} />
                  <span className="truncate">{d.title}</span>
                  <span className="text-muted-foreground text-xs">v{d.version}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <FormField id="ctx-decisions" label="Decisions" hint="One per line">
            <Textarea
              id="ctx-decisions"
              rows={3}
              value={decisions}
              onChange={(e) => setDecisions(e.target.value)}
            />
          </FormField>
          <div className="grid gap-2">
            <p className="text-sm font-medium">Source text</p>
            <Input
              aria-label="Source title"
              placeholder="Title, e.g. Customer email"
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
            />
            <Input
              aria-label="Source link"
              placeholder="Link (optional)"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
            <Textarea
              aria-label="Source content"
              rows={3}
              placeholder="Paste the relevant text. A link alone isn't kept."
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pin.isPending}>
              Pin context
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** What the task's employee works from, whether it is still current, and a way to pin it again. */
export function TaskContext({
  slug,
  task,
  canEdit,
}: {
  slug: string
  task: TaskDetailDto
  canEdit: boolean
}) {
  const { data: context } = useQuery(taskContextQuery(slug, task.id))
  const { data: documents = [] } = useDocuments(slug)
  const [pinning, setPinning] = useState(false)
  const editable = canEdit && task.state !== 'done' && task.state !== 'cancelled'
  const outdated = context?.outdated ?? []
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-muted-foreground text-xs font-medium uppercase">Context</h3>
        {context && (
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            Revision {context.revisionNo}
          </Badge>
        )}
        {editable && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setPinning(true)}>
            {context ? 'Pin again' : 'Pin context'}
          </Button>
        )}
      </div>
      {!context && (
        <p className="text-muted-foreground text-xs">
          {task.employee
            ? `Nothing pinned yet. ${task.employee.displayName} can't start until you pin the context.`
            : 'Nothing pinned.'}
        </p>
      )}
      {outdated.length > 0 && (
        <p role="status" className="bg-muted flex items-start gap-2 rounded-md p-2 text-xs">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Changed since pinned:{' '}
            {outdated
              .map((o) => `${o.title} (v${o.pinnedVersion} → v${o.currentVersion})`)
              .join(', ')}
            . The pinned version stays as agreed until you pin again.
          </span>
        </p>
      )}
      {context && (
        <ul className="grid gap-1 text-xs">
          {context.manifest.documents.map((d) => (
            <li key={d.revisionId} className="break-words">
              Document: {d.title} <span className="text-muted-foreground">v{d.version}</span>
            </li>
          ))}
          {context.manifest.sources.map((s, i) => (
            <li key={i} className="break-words">
              Source: {s.title}
            </li>
          ))}
          {context.manifest.decisions.map((d, i) => (
            <li key={i} className="break-words">
              Decision: {d}
            </li>
          ))}
        </ul>
      )}
      {pinning && (
        <PinDialog
          slug={slug}
          taskId={task.id}
          documents={documents}
          open
          onClose={() => setPinning(false)}
        />
      )}
    </section>
  )
}
