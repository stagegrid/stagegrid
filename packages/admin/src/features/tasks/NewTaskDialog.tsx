import type { BoardDto } from '@stagegrid/shared'
import { useState } from 'react'
import { toast } from 'sonner'

import { FormField } from '@/components/form-field'
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
import { errorMessage } from '@/lib/api'

import { useTaskMutations } from './queries'

/**
 * Creates a task on an item × stage cell. A cell that is still set by hand has to be switched to
 * task progress first; the dialog says so and does it as part of the same, explicit action.
 */
export function NewTaskDialog({
  board,
  open,
  initialCellId,
  onClose,
}: {
  board: BoardDto
  open: boolean
  initialCellId?: string
  onClose: () => void
}) {
  const slug = board.project.slug
  const { create, setMode } = useTaskMutations(slug)
  const [itemId, setItemId] = useState('')
  const [stageId, setStageId] = useState('')
  const [title, setTitle] = useState('')
  const [scope, setScope] = useState('')
  const [criteria, setCriteria] = useState('')

  const fromCell = initialCellId
    ? board.items.flatMap((i) =>
        board.stages
          .filter((s) => board.cells[i.id]?.[s.id]?.id === initialCellId)
          .map((s) => ({ itemId: i.id, stageId: s.id })),
      )[0]
    : undefined
  const item = itemId || fromCell?.itemId || ''
  const stage = stageId || fromCell?.stageId || ''
  const cell = item && stage ? board.cells[item]?.[stage] : undefined
  const skipped = cell?.status === 'skip'
  const needsSwitch = cell?.progressMode === 'manual'
  const pending = create.isPending || setMode.isPending

  const submit = async () => {
    if (!cell) return
    try {
      if (needsSwitch) await setMode.mutateAsync({ cellId: cell.id, mode: 'tasks' })
      await create.mutateAsync({
        cellId: cell.id,
        title: title.trim(),
        scope: scope.trim(),
        acceptanceCriteria: criteria
          .split('\n')
          .map((c) => c.trim())
          .filter(Boolean),
      })
      setTitle('')
      setScope('')
      setCriteria('')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            A task is a piece of work on one item and stage. The stage's status follows its tasks.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Item" id="task-item">
              <Select value={item} onValueChange={setItemId} disabled={!!initialCellId}>
                <SelectTrigger id="task-item" className="w-full min-w-0">
                  <SelectValue placeholder="Choose an item" />
                </SelectTrigger>
                <SelectContent>
                  {board.items.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {'  '.repeat(i.depth)}
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Stage" id="task-stage">
              <Select value={stage} onValueChange={setStageId} disabled={!!initialCellId}>
                <SelectTrigger id="task-stage" className="w-full min-w-0">
                  <SelectValue placeholder="Choose a stage" />
                </SelectTrigger>
                <SelectContent>
                  {board.stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          {skipped && (
            <p role="alert" className="text-destructive text-sm">
              This stage is skipped for this item. Change it on the board first.
            </p>
          )}
          {needsSwitch && !skipped && (
            <p className="bg-muted rounded-md p-2 text-sm">
              This cell's status is set by hand today. Creating the task switches it to follow its
              tasks.
            </p>
          )}
          <FormField label="Title" id="task-title">
            <Input
              id="task-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
          <FormField label="Scope" id="task-scope" hint="Optional">
            <Textarea
              id="task-scope"
              value={scope}
              rows={3}
              onChange={(e) => setScope(e.target.value)}
            />
          </FormField>
          <FormField label="Acceptance criteria" id="task-criteria" hint="One per line">
            <Textarea
              id="task-criteria"
              value={criteria}
              rows={3}
              onChange={(e) => setCriteria(e.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!cell || skipped || !title.trim() || pending}>
              {needsSwitch ? 'Switch cell and create task' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
