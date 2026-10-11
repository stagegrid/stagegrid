import type { Ceilings, ProjectDto, RunnerDto, RunnerEnrollmentDto } from '@stagegrid/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

export const runnersQuery = queryOptions({
  queryKey: ['runners'],
  queryFn: () => api<RunnerDto[]>('/runners'),
  // Online/offline and usage move on their own; keep the page honest without a stream.
  refetchInterval: 15_000,
})

export const useRunners = () => useQuery(runnersQuery)

export const allProjectsQuery = queryOptions({
  queryKey: ['projects', { archived: false }],
  queryFn: () => api<ProjectDto[]>('/projects'),
})

export function useRunnerMutations() {
  const queryClient = useQueryClient()
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ['runners'] })
  return {
    enroll: useMutation({
      mutationFn: (v: { name: string; projectIds: string[] }) =>
        api<RunnerEnrollmentDto>('/runner-enrollments', { body: v }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (v: {
        id: string
        name?: string
        projectIds?: string[]
        maxConcurrent?: number
        ceilings?: Record<string, Ceilings>
      }) => {
        const { id, ...body } = v
        return api<RunnerDto>(`/runners/${id}`, { method: 'PATCH', body })
      },
      onSuccess,
    }),
    revoke: useMutation({
      mutationFn: (id: string) => api(`/runners/${id}/revoke`, { body: {} }),
      onSuccess,
    }),
  }
}
