import { zodResolver } from '@hookform/resolvers/zod'
import type { ProjectDto } from '@stagegrid/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, errorMessage } from '@/lib/api'

import { useProjects } from './queries'

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(100),
  description: z.string().trim().max(2000),
  copyStagesFrom: z.string(),
})
type Values = z.infer<typeof schema>

const DEFAULT = '__default__'

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: projects } = useProjects()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { register, handleSubmit, formState, setValue, watch, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', copyStagesFrom: DEFAULT },
  })

  const onSubmit = handleSubmit(async (v) => {
    setError(null)
    try {
      const project = await api<ProjectDto>('/projects', {
        body: {
          name: v.name,
          description: v.description,
          ...(v.copyStagesFrom === DEFAULT ? {} : { copyStagesFrom: v.copyStagesFrom }),
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      setOpen(false)
      reset()
      await navigate({ to: '/p/$slug', params: { slug: project.slug } })
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          Create project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              You'll be its owner. Add items and teammates next.
            </DialogDescription>
          </DialogHeader>
          <FormField id="project-name" label="Name" error={formState.errors.name?.message}>
            <Input id="project-name" autoFocus {...register('name')} />
          </FormField>
          <FormField
            id="project-description"
            label="Description"
            error={formState.errors.description?.message}
          >
            <Textarea id="project-description" rows={3} {...register('description')} />
          </FormField>
          <FormField id="project-stages" label="Stages">
            <Select
              value={watch('copyStagesFrom')}
              onValueChange={(v) => setValue('copyStagesFrom', v)}
            >
              <SelectTrigger id="project-stages" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>
                  Default: Design, Document, Database, Implement, QA, Deploy
                </SelectItem>
                {projects?.map((p) => (
                  <SelectItem key={p.id} value={p.slug}>
                    Copy from {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={formState.isSubmitting}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
