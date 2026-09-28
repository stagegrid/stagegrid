import type { ProjectDto } from '@stagegrid/shared'
import { queryOptions, useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'

export const projectsQuery = (archived = false) =>
  queryOptions({
    queryKey: qk.projects(archived),
    queryFn: () => api<ProjectDto[]>(`/projects?archived=${archived}`),
  })

export function useProjects(archived = false) {
  return useQuery(projectsQuery(archived))
}
