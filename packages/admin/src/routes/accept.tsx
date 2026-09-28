import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'

import { AcceptForm } from '@/features/auth/AcceptForm'
import { AuthCard } from '@/features/auth/AuthCard'
import { api, errorMessage } from '@/lib/api'

interface TokenInfo {
  kind: 'invite' | 'reset'
  email: string
  name: string
}

export const Route = createFileRoute('/accept')({
  validateSearch: z.object({ token: z.string().catch('') }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    try {
      return {
        info: await api<TokenInfo>(`/auth/token-info?token=${encodeURIComponent(deps.token)}`),
        error: null,
      }
    } catch (e) {
      return { info: null, error: errorMessage(e) }
    }
  },
  component: function AcceptPage() {
    const { info, error } = Route.useLoaderData()
    const { token } = Route.useSearch()
    if (!info) {
      return (
        <AuthCard title="This link doesn't work" description={error ?? undefined}>
          <p className="text-muted-foreground text-sm">
            Ask your admin for a new link, or{' '}
            <Link to="/login" search={{}} className="underline">
              sign in
            </Link>
            .
          </p>
        </AuthCard>
      )
    }
    return (
      <AuthCard
        title={info.kind === 'invite' ? 'Join Stagegrid' : 'Reset your password'}
        description={
          info.kind === 'invite' ? `You're invited as ${info.email}.` : `For ${info.email}`
        }
      >
        <AcceptForm token={token} kind={info.kind} name={info.name} />
      </AuthCard>
    )
  },
})
