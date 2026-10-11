import { createFileRoute, redirect } from '@tanstack/react-router'

import { RunnersPage } from '@/features/runners/RunnersPage'

export const Route = createFileRoute('/_app/admin/runners')({
  beforeLoad: ({ context }) => {
    if (!context.me.isAdmin) throw redirect({ to: '/projects' })
  },
  component: RunnersPage,
})
