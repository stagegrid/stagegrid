import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api'

import { useItemMutations } from './queries'

/** Adds one item per line, at the top level or under `parent`. */
export function AddItemsDialog({
  slug,
  parent,
  open,
  onOpenChange,
}: {
  slug: string
  parent: { id: string; name: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [text, setText] = useState('')
  const { create } = useItemMutations(slug)
  const names = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const submit = async () => {
    if (names.length === 0) return
    try {
      await create.mutateAsync({
        parent: parent?.id ?? null,
        items: names.map((name) => ({ name })),
      })
      setText('')
      onOpenChange(false)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parent ? `Add under "${parent.name}"` : 'Add items'}</DialogTitle>
          <DialogDescription>
            One item per line. For big trees, ask your AI to create them through MCP.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="new-items">Names</Label>
          <Textarea
            id="new-items"
            rows={5}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
            }}
            placeholder={'Login\nDashboard\nReports'}
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={names.length === 0 || create.isPending}>
            Add {names.length > 1 ? `${names.length} items` : 'item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
