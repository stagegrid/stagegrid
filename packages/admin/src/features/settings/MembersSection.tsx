import type { ProjectRole } from '@stagegrid/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, errorMessage } from '@/lib/api'

import { directoryQuery, projectPath, useMembers, useSettingsMutation } from './queries'

const ROLES: ProjectRole[] = ['owner', 'editor', 'viewer']

export function MembersSection({ slug, readOnly }: { slug: string; readOnly: boolean }) {
  const { data: members = [] } = useMembers(slug)
  const { data: directory = [] } = useQuery({ ...directoryQuery, enabled: !readOnly })
  const [pick, setPick] = useState('')
  const [role, setRole] = useState<ProjectRole>('editor')
  const base = `${projectPath(slug)}/members`
  const run = useSettingsMutation(slug, (fn: () => Promise<unknown>) => fn())
  const act = (fn: () => Promise<unknown>) =>
    run.mutateAsync(fn).catch((e: unknown) => toast.error(errorMessage(e)))
  const candidates = directory.filter((u) => !members.some((m) => m.userId === u.id))

  return (
    <section className="grid gap-3">
      <h2 className="text-base font-semibold">Members</h2>
      <ul className="grid max-w-xl divide-y rounded-lg border">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm" title={m.name}>
                {m.name}
              </p>
              <p className="text-muted-foreground truncate text-xs" title={m.email}>
                {m.email}
              </p>
            </div>
            {readOnly ? (
              <span className="text-muted-foreground text-xs capitalize">{m.role}</span>
            ) : (
              <>
                <Select
                  value={m.role}
                  onValueChange={(r) =>
                    void act(() =>
                      api(`${base}/${m.userId}`, { method: 'PATCH', body: { role: r } }),
                    )
                  }
                >
                  <SelectTrigger size="sm" className="w-28" aria-label={`Role for ${m.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void act(() => api(`${base}/${m.userId}`, { method: 'DELETE' }))}
                >
                  Remove
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="flex max-w-xl gap-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="User to add">
              <SelectValue
                placeholder={candidates.length ? 'Choose a user' : 'Everyone is already a member'}
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={role} onValueChange={(r) => setRole(r as ProjectRole)}>
            <SelectTrigger className="w-28" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!pick}
            onClick={() =>
              void act(() => api(base, { body: { userId: pick, role } })).then(() => setPick(''))
            }
          >
            Add member
          </Button>
        </div>
      )}
    </section>
  )
}
