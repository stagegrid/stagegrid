import type { StageDto } from '@stagegrid/shared'
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'

import { projectPath, useSettingsMutation, useStages } from './queries'

export function StagesSection({ slug, readOnly }: { slug: string; readOnly: boolean }) {
  const { data: stages = [] } = useStages(slug)
  const active = stages.filter((s) => !s.archivedAt)
  const archived = stages.filter((s) => s.archivedAt)
  const [newName, setNewName] = useState('')
  const base = `${projectPath(slug)}/stages`
  const run = useSettingsMutation(slug, (fn: () => Promise<unknown>) => fn())
  const act = (fn: () => Promise<unknown>) =>
    run.mutateAsync(fn).catch((e: unknown) => toast.error(errorMessage(e)))

  const rename = (s: StageDto, name: string) =>
    name.trim() &&
    name.trim() !== s.name &&
    act(() => api(`${base}/${s.id}`, { method: 'PATCH', body: { name: name.trim() } }))
  const moveBy = (i: number, delta: -1 | 1) => {
    const s = active[i]!
    const other = active[i + delta]
    if (!other) return
    return act(() =>
      api(`${base}/${s.id}/move`, {
        body: delta === -1 ? { beforeId: other.id } : { afterId: other.id },
      }),
    )
  }

  return (
    <section className="grid gap-3">
      <h2 className="text-base font-semibold">Stages</h2>
      <ul className="grid max-w-xl gap-1.5">
        {active.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <Input
              defaultValue={s.name}
              disabled={readOnly}
              onBlur={(e) => void rename(s, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-label={`Stage ${i + 1} name`}
              className="h-8"
            />
            {!readOnly && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === 0}
                  onClick={() => void moveBy(i, -1)}
                  aria-label={`Move ${s.name} left`}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === active.length - 1}
                  onClick={() => void moveBy(i, 1)}
                  aria-label={`Move ${s.name} right`}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    confirm(`Archive ${s.name}? Its cells are hidden but kept.`) &&
                    void act(() => api(`${base}/${s.id}/archive`, { body: {} }))
                  }
                  aria-label={`Archive ${s.name}`}
                >
                  <ArchiveIcon />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <form
          className="flex max-w-xl gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!newName.trim()) return
            void act(() => api(base, { body: { name: newName.trim() } })).then(() => setNewName(''))
          }}
        >
          <Input
            placeholder="SIT"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8"
            aria-label="New stage name"
          />
          <Button type="submit" size="sm" variant="outline">
            <PlusIcon />
            Add stage
          </Button>
        </form>
      )}
      {archived.length > 0 && (
        <div className="grid max-w-xl gap-1.5">
          <h3 className="text-muted-foreground text-xs font-medium uppercase">Archived stages</h3>
          {archived.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.name}</span>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void act(() => api(`${base}/${s.id}/restore`, { body: {} }))}
                >
                  <RotateCcwIcon />
                  Restore
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
