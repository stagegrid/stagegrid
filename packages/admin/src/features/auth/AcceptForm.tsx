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

const schema = z
  .object({ name: z.string().trim().max(100), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: "Passwords don't match" })
type Values = z.infer<typeof schema>

export function AcceptForm({
  token,
  kind,
  name,
}: {
  token: string
  kind: 'invite' | 'reset'
  name: string
}) {
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name },
  })
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      const body =
        kind === 'invite'
          ? { token, name: values.name || undefined, password: values.password }
          : { token, password: values.password }
      const { user } = await api<{ user: unknown }>('/auth/accept', { body })
      queryClient.setQueryData(qk.me, user)
      await navigate({ to: '/projects' })
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {kind === 'invite' && (
        <FormField id="name" label="Your name" error={formState.errors.name?.message}>
          <Input id="name" autoComplete="name" {...register('name')} />
        </FormField>
      )}
      <FormField
        id="password"
        label="New password"
        hint="At least 10 characters"
        error={formState.errors.password?.message}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          {...register('password')}
        />
      </FormField>
      <FormField id="confirm" label="Confirm password" error={formState.errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} />
      </FormField>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={formState.isSubmitting}>
        {kind === 'invite' ? 'Join Stagegrid' : 'Set new password'}
      </Button>
    </form>
  )
}
