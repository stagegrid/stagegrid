import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { meQuery } from '@/features/auth/queries'
import { ConsentCard } from '@/features/oauth/ConsentCard'

export const Route = createFileRoute('/authorize')({
  validateSearch: z.record(z.string(), z.string()),
  beforeLoad: async ({ context, location }) => {
    if (!(await context.queryClient.fetchQuery(meQuery)))
      throw redirect({ to: '/login', search: { redirect: location.href } })
  },
  component: function AuthorizeRoute() {
    return <ConsentCard query={Route.useSearch()} />
  },
})
