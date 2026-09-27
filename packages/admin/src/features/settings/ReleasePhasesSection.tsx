import type { ProjectDto } from '@stagegrid/shared'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'

import { projectPath, useSettingsMutation } from './queries'

/** Default phases that new releases start with (spec 07 §4 "Project settings → Releases"). */
export function ReleasePhasesSection({
  project,
  readOnly,
}: {
  project: ProjectDto
  readOnly: boolean
}) {
  const [rows, setRows] = useState(project.defaultReleasePhases)
  const save = useSettingsMutation(project.slug, (defaultReleasePhases: typeof rows) =>
    api(projectPath(project.slug), { method: 'PATCH', body: { defaultReleasePhases } }),
  )
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const next = [...r]
      const [x] = next.splice(i, 1)
      next.splice(i + d, 0, x!)
      return next
    })
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-base font-semibold">Releases</h2>
        <p className="text-muted-foreground text-sm">
          Phases every new release starts with. The freeze phase is when development should be
          finished.
        </p>
      </div>
      <ul className="grid max-w-xl gap-1.5">
        {rows.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input
              value={p.name}
              disabled={readOnly}
              onChange={(e) =>
                setRows((r) => r.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
              aria-label={`Default phase ${i + 1}`}
              className="h-8"
            />
            <label className="flex items-center gap-1 text-xs whitespace-nowrap">
              <input
                type="radio"
                name="default-freeze"
                disabled={readOnly}
                checked={!!p.freeze}
                onChange={() => setRows((r) => r.map((x, j) => ({ ...x, freeze: j === i })))}
              />
              Freeze
            </label>
            {!readOnly && (
              <>
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
              </>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((r) => [...r, { name: 'Phase' }])}
            disabled={rows.length >= 10}
          >
            <PlusIcon />
            Add phase
          </Button>
          <Button
            size="sm"
            disabled={rows.some((r) => !r.name.trim()) || save.isPending}
            onClick={() =>
              save.mutate(
                rows.map((r) => ({ name: r.name.trim(), ...(r.freeze ? { freeze: true } : {}) })),
                {
                  onSuccess: () => toast('Default phases saved'),
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            Save phases
          </Button>
        </div>
      )}
    </section>
  )
}
