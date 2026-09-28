import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { meQuery } from '@/features/auth/queries'
import { PrintPage } from '@/features/docs/PrintPage'

export const Route = createFileRoute('/print/$slug/$docId')({
  validateSearch: z.object({ v: z.number().int().min(1).optional().catch(undefined) }),
  beforeLoad: async ({ context, location }) => {
    if (!(await context.queryClient.fetchQuery(meQuery)))
      throw redirect({ to: '/login', search: { redirect: location.href } })
  },
  component: function PrintRoute() {
    const { slug, docId } = Route.useParams()
    const { v } = Route.useSearch()
    return <PrintPage slug={slug} docId={docId} version={v} />
  },
})
