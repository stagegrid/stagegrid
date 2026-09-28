import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuthCard } from '@/features/auth/AuthCard'
import { setupStatusQuery } from '@/features/auth/queries'
import { SetupForm } from '@/features/auth/SetupForm'

export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ context }) => {
    const { needsSetup } = await context.queryClient.fetchQuery(setupStatusQuery)
    if (!needsSetup) throw redirect({ to: '/login' })
  },
  component: () => (
    <AuthCard
      title="Set up Stagegrid"
      description="Create the first admin account. You can invite your team afterwards."
    >
      <SetupForm />
    </AuthCard>
  ),
})
