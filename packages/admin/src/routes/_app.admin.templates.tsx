import { createFileRoute, redirect } from '@tanstack/react-router'

import { TemplatesPage } from '@/features/admin/TemplatesPage'

export const Route = createFileRoute('/_app/admin/templates')({
  beforeLoad: ({ context }) => {
    if (!context.me.isAdmin) throw redirect({ to: '/projects' })
  },
  component: TemplatesPage,
})
