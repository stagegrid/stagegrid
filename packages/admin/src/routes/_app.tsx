import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { AppShell } from '@/components/app-shell'
import { meQuery, setupStatusQuery } from '@/features/auth/queries'

/** Pathless layout: every signed-in page renders inside the shell. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery(meQuery)
    if (!me) {
      const { needsSetup } = await context.queryClient.fetchQuery(setupStatusQuery)
      throw redirect(
        needsSetup ? { to: '/setup' } : { to: '/login', search: { redirect: location.href } },
      )
    }
    return { me }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})
