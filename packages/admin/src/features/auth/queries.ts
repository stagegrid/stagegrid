import type { UserDto } from '@stagegrid/shared'
import { queryOptions, useQuery } from '@tanstack/react-query'

import { api, ApiError } from '@/lib/api'
import { qk } from '@/lib/query-keys'

/** The signed-in user, or null when there's no valid session. */
export const meQuery = queryOptions({
  queryKey: qk.me,
  queryFn: async (): Promise<UserDto | null> => {
    try {
      return await api<UserDto>('/me')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null
      throw e
    }
  },
  staleTime: 60_000,
})

export const setupStatusQuery = queryOptions({
  queryKey: qk.setupStatus,
  queryFn: () => api<{ needsSetup: boolean }>('/setup/status'),
  staleTime: 0,
})

export function useMe() {
  return useQuery(meQuery)
}
