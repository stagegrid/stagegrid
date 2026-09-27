import type { ReleasePhaseDto, ReleasePhaseInput } from '@stagegrid/shared'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'

/** Edit a release's phases in order; one may be the freeze point (work should be done before it). */
export function PhasesDialog({
  phases,
  open,
  onOpenChange,
  onSave,
}: {
  phases: ReleasePhaseDto[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onSave: (phases: ReleasePhaseInput[]) => Promise<unknown>
}) {
  const [rows, setRows] = useState<ReleasePhaseInput[]>(() => phases.map((p) => ({ ...p })))
  const set = (i: number, patch: Partial<ReleasePhaseInput>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const next = [...r]
      const [x] = next.splice(i, 1)
      next.splice(i + d, 0, x!)
      return next
    })
  const save = async () => {
    try {
      await onSave(
        rows.map((r) => ({
          ...r,
          name: r.name.trim(),
          plannedStart: r.plannedStart || null,
          plannedEnd: r.plannedEnd || null,
        })),
      )
      onOpenChange(false)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Phases</DialogTitle>
          <DialogDescription>
            For example Dev, SIT, UAT. Mark the phase before which development should be finished as
            the freeze point.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {rows.map((p, i) => (
            <div key={p.id ?? i} className="flex items-center gap-2">
              <Input
                value={p.name}
                onChange={(e) => set(i, { name: e.target.value })}
                aria-label={`Phase ${i + 1} name`}
                className="h-8 w-28"
              />
              <Input
                type="date"
                value={p.plannedStart ?? ''}
                onChange={(e) => set(i, { plannedStart: e.target.value })}
                aria-label={`Phase ${i + 1} start`}
                className="h-8"
              />
              <Input
                type="date"
                value={p.plannedEnd ?? ''}
                onChange={(e) => set(i, { plannedEnd: e.target.value })}
                aria-label={`Phase ${i + 1} end`}
                className="h-8"
              />
              <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                <input
                  type="radio"
                  name="freeze"
                  checked={!!p.freeze}
                  onChange={() => setRows((r) => r.map((x, j) => ({ ...x, freeze: j === i })))}
                />
                Freeze
              </label>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={`Move ${p.name} up`}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Move ${p.name} down`}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                aria-label={`Remove ${p.name}`}
              >
                <XIcon />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRows((r) => [...r, { name: `Phase ${r.length + 1}` }])}
              disabled={rows.length >= 10}
            >
              <PlusIcon />
              Add phase
            </Button>
            {rows.some((r) => r.freeze) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows((r) => r.map((x) => ({ ...x, freeze: false })))}
              >
                Clear freeze
              </Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void save()} disabled={rows.some((r) => !r.name.trim())}>
            Save phases
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
