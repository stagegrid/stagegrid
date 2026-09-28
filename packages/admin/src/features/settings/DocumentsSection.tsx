import type { DocTemplateDto } from '@stagegrid/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'

/** Which document templates this project uses; none selected = all (spec 06 §6). */
export function DocumentsSection({ slug, readOnly }: { slug: string; readOnly: boolean }) {
  const queryClient = useQueryClient()
  const { data: templates = [] } = useQuery({
    queryKey: ['doc-templates', slug, 'all'],
    queryFn: () =>
      api<(DocTemplateDto & { selected: boolean })[]>(
        `/projects/${encodeURIComponent(slug)}/doc-templates?all=true`,
      ),
  })
  const selectedIds = templates.filter((t) => t.selected).map((t) => t.id)
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const current = picked ?? new Set(selectedIds)
  const save = useMutation({
    mutationFn: () =>
      api(`/projects/${slug}/doc-templates`, {
        method: 'PUT',
        body: { templateIds: [...current] },
      }),
    onSuccess: () => {
      setPicked(null)
      toast('Saved')
      return queryClient.invalidateQueries({ queryKey: ['doc-templates', slug] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-base font-semibold">Documents</h2>
        <p className="text-muted-foreground text-sm">
          Templates this project uses. With none ticked, every template is available.
        </p>
      </div>
      <div className="grid max-w-xl gap-1.5">
        {templates.map((t) => (
          <Label key={t.id} className="flex items-center gap-2 font-normal">
            <Checkbox
              disabled={readOnly}
              checked={current.has(t.id)}
              onCheckedChange={(v) => {
                const next = new Set(current)
                if (v === true) next.add(t.id)
                else next.delete(t.id)
                setPicked(next)
              }}
            />
            {t.name}
            <span className="text-muted-foreground text-xs capitalize">({t.level})</span>
          </Label>
        ))}
      </div>
      {!readOnly && picked && (
        <Button size="sm" className="justify-self-start" onClick={() => save.mutate()}>
          Save templates
        </Button>
      )}
    </section>
  )
}
