import { zodResolver } from '@hookform/resolvers/zod'
import { type LoginInput, loginInput } from '@stagegrid/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { qk } from '@/lib/query-keys'

export function LoginForm({ redirectTo = '/projects' }: { redirectTo?: string }) {
  const { register, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginInput),
  })
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const onSubmit = handleSubmit(async (values) => {
    setError(null)
    try {
      const { user } = await api<{ user: unknown }>('/auth/login', { body: values })
      queryClient.setQueryData(qk.me, user)
      await navigate({ to: redirectTo })
    } catch (e) {
      setError(errorMessage(e))
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormField id="email" label="Email" error={formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" autoFocus {...register('email')} />
      </FormField>
      <FormField id="password" label="Password" error={formState.errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...register('password')}
        />
      </FormField>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={formState.isSubmitting}>
        Sign in
      </Button>
    </form>
  )
}
