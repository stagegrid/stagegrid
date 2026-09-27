import { zodResolver } from '@hookform/resolvers/zod'
import type { ProjectDto } from '@stagegrid/shared'
import { slugSchema, timezoneSchema } from '@stagegrid/shared'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { FormField } from '@/components/form-field'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'

import { projectPath, useSettingsMutation } from './queries'

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slugSchema,
  description: z.string().trim().max(2000),
  timezone: timezoneSchema,
  staleDays: z.coerce.number().int().min(1).max(365),
})
type Values = z.input<typeof schema>

export function GeneralSection({ project, readOnly }: { project: ProjectDto; readOnly: boolean }) {
  const navigate = useNavigate()
  const { register, handleSubmit, formState } = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: {
      name: project.name,
      slug: project.slug,
      description: project.description,
      timezone: project.timezone,
      staleDays: project.staleDays,
    },
  })
  const save = useSettingsMutation(project.slug, (v: z.output<typeof schema>) =>
    api<ProjectDto>(projectPath(project.slug), { method: 'PATCH', body: v }),
  )
  const archive = useSettingsMutation(project.slug, () =>
    api(`${projectPath(project.slug)}/${project.archivedAt ? 'unarchive' : 'archive'}`, {
      body: {},
    }),
  )

  const onSubmit = handleSubmit(async (v) => {
    try {
      const updated = (await save.mutateAsync(v)) as ProjectDto
      toast('Project saved')
      if (updated.slug !== project.slug)
        await navigate({ to: '/p/$slug/settings', params: { slug: updated.slug } })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  })

  return (
    <section className="grid gap-4">
      <h2 className="text-base font-semibold">General</h2>
      <form onSubmit={onSubmit} className="grid max-w-xl gap-4">
        <fieldset disabled={readOnly} className="grid gap-4">
          <FormField id="p-name" label="Name" error={formState.errors.name?.message}>
            <Input id="p-name" {...register('name')} />
          </FormField>
          <FormField
            id="p-slug"
            label="Slug"
            hint="Used in URLs and by AI tools"
            error={formState.errors.slug?.message}
          >
            <Input id="p-slug" {...register('slug')} />
          </FormField>
          <FormField
            id="p-description"
            label="Description"
            error={formState.errors.description?.message}
          >
            <Textarea id="p-description" rows={3} {...register('description')} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="p-tz" label="Time zone" error={formState.errors.timezone?.message}>
              <Input id="p-tz" {...register('timezone')} />
            </FormField>
            <FormField
              id="p-stale"
              label="Needs update after (days)"
              error={formState.errors.staleDays?.message}
            >
              <Input id="p-stale" type="number" min={1} max={365} {...register('staleDays')} />
            </FormField>
          </div>
        </fieldset>
        {!readOnly && (
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline">
                  {project.archivedAt ? 'Unarchive project' : 'Archive project'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {project.archivedAt ? 'Unarchive' : 'Archive'} {project.name}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {project.archivedAt
                      ? 'It becomes editable again.'
                      : 'It moves to Archived and becomes read-only. You can unarchive it later.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      void archive
                        .mutateAsync(undefined)
                        .catch((e: unknown) => toast.error(errorMessage(e)))
                    }
                  >
                    {project.archivedAt ? 'Unarchive' : 'Archive'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </form>
    </section>
  )
}
