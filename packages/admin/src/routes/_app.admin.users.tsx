import { createFileRoute, redirect } from '@tanstack/react-router'

import { UsersPage } from '@/features/admin/UsersPage'

export const Route = createFileRoute('/_app/admin/users')({
  beforeLoad: ({ context }) => {
    if (!context.me.isAdmin) throw redirect({ to: '/projects' })
  },
  component: UsersPage,
})
