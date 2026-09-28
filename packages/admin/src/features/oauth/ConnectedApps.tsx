import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlugIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { api, errorMessage } from '@/lib/api'
import { relativeTime } from '@/lib/format'

interface Grant {
  clientId: string
  clientName: string
  createdAt: string
  lastUsedAt: string | null
}

export function ConnectedApps() {
  const queryClient = useQueryClient()
  const { data: grants = [] } = useQuery({
    queryKey: ['oauth-grants'],
    queryFn: () => api<Grant[]>('/me/oauth-grants'),
  })
  const revoke = useMutation({
    mutationFn: (clientId: string) =>
      api(`/me/oauth-grants/${encodeURIComponent(clientId)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['oauth-grants'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-base font-semibold">Connected apps</h2>
        <p className="text-muted-foreground text-sm">
          Apps you allowed through sign-in, such as claude.ai or ChatGPT.
        </p>
      </div>
      {grants.length === 0 ? (
        <p className="text-muted-foreground text-sm">None yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {grants.map((g) => (
            <li key={g.clientId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <PlugIcon className="text-muted-foreground size-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate">{g.clientName}</p>
                <p className="text-muted-foreground text-xs">
                  connected {relativeTime(g.createdAt)} ·{' '}
                  {g.lastUsedAt ? `used ${relativeTime(g.lastUsedAt)}` : 'not used yet'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => revoke.mutate(g.clientId)}>
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
