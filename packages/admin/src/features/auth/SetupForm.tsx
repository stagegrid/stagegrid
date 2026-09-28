import { zodResolver } from '@hookform/resolvers/zod'
import { passwordSchema } from '@stagegrid/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { qk } from '@/lib/query-keys'

const schema = z.object({
  instanceName: z.string().trim().min(1, 'Enter a name').max(100),
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email: z.email('Enter a valid email'),
  password: passwordSchema,
})
type Values = z.infer<typeof schema>

export function SetupForm() {
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { instanceName: 'Stagegrid' },
  })
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      const { user } = await api<{ user: unknown }>('/setup', { body: { ...values, timezone } })
      queryClient.setQueryData(qk.me, user)
      queryClient.setQueryData(qk.setupStatus, { needsSetup: false })
      await navigate({ to: '/projects' })
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormField
        id="instanceName"
        label="Workspace name"
        error={formState.errors.instanceName?.message}
      >
        <Input id="instanceName" {...register('instanceName')} />
      </FormField>
      <FormField id="name" label="Your name" error={formState.errors.name?.message}>
        <Input id="name" autoComplete="name" autoFocus {...register('name')} />
      </FormField>
      <FormField id="email" label="Email" error={formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...register('email')} />
      </FormField>
      <FormField
        id="password"
        label="Password"
        hint="At least 10 characters"
        error={formState.errors.password?.message}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register('password')}
        />
      </FormField>
      <p className="text-muted-foreground text-xs">Time zone: {timezone}</p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={formState.isSubmitting}>
        Create admin account
      </Button>
    </form>
  )
}
