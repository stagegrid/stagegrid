import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { AuthCard } from '@/features/auth/AuthCard'
import { LoginForm } from '@/features/auth/LoginForm'
import { meQuery, setupStatusQuery } from '@/features/auth/queries'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().startsWith('/').optional() }),
  beforeLoad: async ({ context, search }) => {
    const { needsSetup } = await context.queryClient.fetchQuery(setupStatusQuery)
    if (needsSetup) throw redirect({ to: '/setup' })
    if (await context.queryClient.fetchQuery(meQuery))
      throw redirect({ to: search.redirect ?? '/projects' })
  },
  component: function LoginPage() {
    const { redirect: to } = Route.useSearch()
    return (
      <AuthCard title="Sign in">
        <LoginForm redirectTo={to} />
      </AuthCard>
    )
  },
})
