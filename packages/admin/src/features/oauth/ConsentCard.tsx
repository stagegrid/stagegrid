import { useMutation, useQuery } from '@tanstack/react-query'
import { ShieldCheckIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AuthCard } from '@/features/auth/AuthCard'
import { useMe } from '@/features/auth/queries'
import { api, errorMessage } from '@/lib/api'

/** OAuth consent for MCP clients such as claude.ai and ChatGPT (spec 04 §8). */
export function ConsentCard({ query }: { query: Record<string, string> }) {
  const { data: me } = useMe()
  const qs = new URLSearchParams(query).toString()
  const { data: client, error } = useQuery({
    queryKey: ['oauth-client', qs],
    queryFn: () =>
      api<{ clientName: string; redirectHost: string; scope: string }>(`/oauth/client?${qs}`),
    retry: false,
  })
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      api<{ redirect: string }>('/oauth/consent', { body: { query, approve } }),
    onSuccess: ({ redirect }) => window.location.assign(redirect),
  })

  if (error) {
    return (
      <AuthCard title="Can't connect this app" description={errorMessage(error)}>
        <p className="text-muted-foreground text-sm">Start the connection again from the app.</p>
      </AuthCard>
    )
  }
  return (
    <AuthCard
      title={client ? `Connect ${client.clientName}` : 'Connect an app'}
      description={me ? `Signed in as ${me.email}` : undefined}
    >
      <div className="grid gap-4">
        <div className="flex gap-3 text-sm">
          <ShieldCheckIcon className="text-primary mt-0.5 size-5 shrink-0" />
          <p>
            <strong>{client?.clientName ?? '…'}</strong> will be able to read and update the
            projects you have access to, with your permissions.
          </p>
        </div>
        {client && (
          <p className="text-muted-foreground text-xs">
            You'll be sent back to {client.redirectHost}. You can disconnect it any time in Profile.
          </p>
        )}
        {decide.error && <p className="text-destructive text-sm">{errorMessage(decide.error)}</p>}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => decide.mutate(true)}
            disabled={!client || decide.isPending}
          >
            Allow
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => decide.mutate(false)}
            disabled={!client || decide.isPending}
          >
            Deny
          </Button>
        </div>
      </div>
    </AuthCard>
  )
}
