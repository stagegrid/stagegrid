import type { TokenDto } from '@stagegrid/shared'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

export const tokensQuery = queryOptions({
  queryKey: ['tokens'],
  queryFn: () => api<TokenDto[]>('/me/tokens'),
})

export function useCreateToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; expiresInDays?: 30 | 90 | 365 }) =>
      api<{ token: string; meta: TokenDto }>('/me/tokens', { body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tokens'] }),
  })
}

export function useRevokeToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/me/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tokens'] }),
  })
}
