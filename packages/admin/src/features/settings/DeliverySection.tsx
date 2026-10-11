import { DELIVERY_MODES, type DeliveryMode, type ProjectDto } from '@stagegrid/shared'
import { useState } from 'react'
import { toast } from 'sonner'

import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, errorMessage } from '@/lib/api'

import { projectPath, useSettingsMutation } from './queries'

const MODE_LABEL: Record<DeliveryMode, string> = {
  local: 'Keep it on the runner (no push)',
  branch: 'Push a branch',
  pull_request: 'Open a pull request',
}

/** How far an AI employee's finished work may leave the runner. Nothing is ever merged automatically. */
export function DeliverySection({ project, readOnly }: { project: ProjectDto; readOnly: boolean }) {
  const [mode, setMode] = useState<DeliveryMode>(project.delivery.mode)
  const [repo, setRepo] = useState(project.delivery.repo ?? '')
  const save = useSettingsMutation(project.slug, (delivery: ProjectDto['delivery']) =>
    api(projectPath(project.slug), { method: 'PATCH', body: { delivery } }),
  )
  const needsRepo = mode !== 'local'
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-base font-semibold">Delivery</h2>
        <p className="text-muted-foreground text-sm">
          What happens to an AI employee's finished work. A person always accepts it, and nothing is
          merged for you.
        </p>
      </div>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(
            { mode, repo: needsRepo ? repo.trim() || null : null },
            { onError: (err) => toast.error(errorMessage(err)) },
          )
        }}
      >
        <FormField id="delivery-mode" label="When work is finished">
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as DeliveryMode)}
            disabled={readOnly}
          >
            <SelectTrigger id="delivery-mode" className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIVERY_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABEL[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {needsRepo && (
          <FormField
            id="delivery-repo"
            label="GitHub repository"
            hint="owner/name. Branches and pull requests must be in this repository."
          >
            <Input
              id="delivery-repo"
              value={repo}
              disabled={readOnly}
              placeholder="acme/clinic-os"
              onChange={(e) => setRepo(e.target.value)}
            />
          </FormField>
        )}
        {!readOnly && (
          <Button type="submit" size="sm" className="justify-self-start" disabled={save.isPending}>
            Save
          </Button>
        )}
      </form>
    </section>
  )
}
