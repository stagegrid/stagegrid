import type { ProjectDto, ProjectRole, StageDto } from '@stagegrid/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'

export interface MemberDto {
  userId: string
  name: string
  email: string
  role: ProjectRole
  status: 'invited' | 'active' | 'disabled'
}

const p = (slug: string) => `/projects/${encodeURIComponent(slug)}`

export const projectQuery = (slug: string) =>
  queryOptions({ queryKey: qk.project(slug), queryFn: () => api<ProjectDto>(p(slug)) })
export const stagesQuery = (slug: string) =>
  queryOptions({ queryKey: qk.stages(slug), queryFn: () => api<StageDto[]>(`${p(slug)}/stages`) })
export const membersQuery = (slug: string) =>
  queryOptions({
    queryKey: qk.members(slug),
    queryFn: () => api<MemberDto[]>(`${p(slug)}/members`),
  })
export const directoryQuery = queryOptions({
  queryKey: qk.directory,
  queryFn: () => api<{ id: string; name: string; email: string }[]>('/users/directory'),
})

export const useProject = (slug: string) => useQuery(projectQuery(slug))
export const useStages = (slug: string) => useQuery(stagesQuery(slug))
export const useMembers = (slug: string) => useQuery(membersQuery(slug))

export function useSettingsMutation<V>(slug: string, fn: (v: V) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.project(slug) }),
        queryClient.invalidateQueries({ queryKey: qk.stages(slug) }),
        queryClient.invalidateQueries({ queryKey: qk.members(slug) }),
        queryClient.invalidateQueries({ queryKey: qk.board(slug) }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  })
}

export const projectPath = p
