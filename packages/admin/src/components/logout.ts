import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { api } from '@/lib/api'

export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {})
    queryClient.clear()
    await navigate({ to: '/login' })
  }
}
