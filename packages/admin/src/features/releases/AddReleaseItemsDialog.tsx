import type { BoardDto } from '@stagegrid/shared'
import { useState } from 'react'
import { toast } from 'sonner'

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
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/api'

import type { AddItemsResult, useReleaseMutations } from './queries'

/**
 * Pick items from the board tree, choose New or Change (with stages to redo), preview which done
 * cells will be reopened, then add. Checking a parent can include its children.
 */
export function AddReleaseItemsDialog({
  board,
  inRelease,
  open,
  onOpenChange,
  mutations,
}: {
  board: BoardDto
  inRelease: ReadonlySet<string>
  open: boolean
  onOpenChange: (o: boolean) => void
  mutations: ReturnType<typeof useReleaseMutations>
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [kind, setKind] = useState<'new' | 'change'>('new')
  const [stages, setStages] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<AddItemsResult | null>(null)
  const children = new Map<string, string[]>()
  for (const i of board.items)
    if (i.parentId) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i.id])

  const descendants = (id: string): string[] =>
    (children.get(id) ?? []).flatMap((c) => [c, ...descendants(c)])
  const toggle = (id: string) => {
    setPreview(null)
    const on = !picked.has(id)
    const below = descendants(id)
    const ids =
      on && below.length > 0 && confirm(`Include ${below.length} item(s) under it?`)
        ? [id, ...below]
        : [id]
    setPicked((prev) => {
      const next = new Set(prev)
      for (const x of ids) {
        if (inRelease.has(x)) continue
        if (on) next.add(x)
        else next.delete(x)
      }
      return next
    })
  }
  const request = (dryRun: boolean) => ({
    dryRun,
    items: [...picked].map((item) =>
      kind === 'new' ? { item, kind } : { item, kind, stages: [...stages] },
    ),
  })
  const run = async (dryRun: boolean) => {
    try {
      const res = await mutations.addItems.mutateAsync(request(dryRun))
      if (dryRun) setPreview(res)
      else {
        onOpenChange(false)
        setPicked(new Set())
        setPreview(null)
      }
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const valid = picked.size > 0 && (kind === 'new' || stages.size > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add items to the release</DialogTitle>
          <DialogDescription>
            New = built in this release (every stage). Change = an existing item modified here; pick
            the stages to redo.
          </DialogDescription>
        </DialogHeader>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={kind}
          onValueChange={(v) => {
            if (!v) return
            setKind(v as 'new' | 'change')
            setPreview(null)
          }}
          aria-label="Kind"
        >
          <ToggleGroupItem value="new">New</ToggleGroupItem>
          <ToggleGroupItem value="change">Change</ToggleGroupItem>
        </ToggleGroup>
        {kind === 'change' && (
          <div className="flex flex-wrap gap-3" role="group" aria-label="Stages to redo">
            {board.stages.map((s) => (
              <Label key={s.id} className="flex items-center gap-1.5 text-xs font-normal">
                <Checkbox
                  checked={stages.has(s.id)}
                  onCheckedChange={(v) => {
                    setPreview(null)
                    setStages((prev) => {
                      const next = new Set(prev)
                      if (v === true) next.add(s.id)
                      else next.delete(s.id)
                      return next
                    })
                  }}
                />
                {s.name}
              </Label>
            ))}
          </div>
        )}
        <ul
          className="grid max-h-72 gap-0.5 overflow-y-auto rounded-md border p-2"
          aria-label="Items"
        >
          {board.items.map((i) => (
            <li key={i.id} style={{ paddingLeft: i.depth * 16 }}>
              <Label className="flex items-center gap-2 py-0.5 text-sm font-normal">
                <Checkbox
                  checked={picked.has(i.id) || inRelease.has(i.id)}
                  disabled={inRelease.has(i.id)}
                  onCheckedChange={() => toggle(i.id)}
                />
                {i.name}
                {inRelease.has(i.id) && (
                  <span className="text-muted-foreground text-xs">(already in release)</span>
                )}
              </Label>
            </li>
          ))}
        </ul>
        {preview && (
          <div className="bg-muted/40 grid gap-1 rounded-md p-3 text-xs">
            <p>
              Adds {preview.added.length} item(s), {preview.added.reduce((n, a) => n + a.cells, 0)}{' '}
              cells.
            </p>
            {preview.reopened.length > 0 ? (
              <p>
                Reopens (done → to do):{' '}
                {preview.reopened.map((r) => `${r.item} › ${r.stage}`).join(', ')}
              </p>
            ) : (
              <p>Nothing will be reopened.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void run(true)} disabled={!valid}>
            Preview
          </Button>
          <Button onClick={() => void run(false)} disabled={!valid || mutations.addItems.isPending}>
            Add {picked.size || ''} item{picked.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
