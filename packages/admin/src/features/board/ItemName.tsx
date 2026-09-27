import type { BoardDto } from '@stagegrid/shared'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

import { useItemMutations } from './queries'
import type { VisibleRow } from './visible-rows'

export const INDENT_PX = 16

function countDescendants(board: BoardDto, id: string): number {
  const children = new Map<string, string[]>()
  for (const i of board.items)
    if (i.parentId) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i.id])
  let n = 0
  const stack = [...(children.get(id) ?? [])]
  while (stack.length) {
    n += 1
    stack.push(...(children.get(stack.pop()!) ?? []))
  }
  return n
}

export function ItemName({
  board,
  row,
  onToggle,
  onAddChild,
  dragHandleProps,
}: {
  board: BoardDto
  row: VisibleRow
  onToggle: () => void
  onAddChild: () => void
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>
}) {
  const canEdit = board.project.role !== 'viewer'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(row.item.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const m = useItemMutations(board.project.slug)
  const { item } = row

  const commit = async () => {
    setEditing(false)
    const name = draft.trim()
    if (!name || name === item.name) return setDraft(item.name)
    try {
      await m.rename.mutateAsync({ id: item.id, name })
    } catch (e) {
      setDraft(item.name)
      toast.error(errorMessage(e))
    }
  }

  return (
    <div
      className={cn(
        'group flex h-full min-w-0 items-center gap-1 overflow-hidden pr-1',
        row.context && 'opacity-50',
      )}
      style={{ paddingLeft: item.depth * INDENT_PX }}
    >
      {canEdit && (
        <span
          {...dragHandleProps}
          className="text-muted-foreground cursor-grab opacity-0 group-hover:opacity-100"
          aria-hidden
        >
          <GripVerticalIcon className="size-3.5" />
        </span>
      )}
      {row.hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground"
          aria-label={row.collapsed ? `Expand ${item.name}` : `Collapse ${item.name}`}
        >
          {row.collapsed ? (
            <ChevronRightIcon className="size-4" />
          ) : (
            <ChevronDownIcon className="size-4" />
          )}
        </button>
      ) : (
        <span className="w-4" />
      )}
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') {
              setDraft(item.name)
              setEditing(false)
            }
          }}
          className="h-7"
          aria-label="Item name"
        />
      ) : (
        <span
          className="truncate text-sm"
          title={item.name}
          onDoubleClick={() => canEdit && setEditing(true)}
        >
          {item.name}
        </span>
      )}
      {canEdit && !editing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto size-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Actions for ${item.name}`}
            >
              <EllipsisIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onAddChild}>
              <PlusIcon />
              Add child
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{item.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const n = countDescendants(board, item.id)
                return n > 0 ? `This also deletes ${n} item${n === 1 ? '' : 's'} under it. ` : ''
              })()}
              Their history is kept but they leave the board.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void m.remove.mutateAsync(item.id).catch((e: unknown) => {
                  toast.error(errorMessage(e))
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
