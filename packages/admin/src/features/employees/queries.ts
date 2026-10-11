import type {
  CreateContextInput,
  CreateEmployeeInput,
  EmployeeDto,
  TaskContextDto,
  UpdateEmployeeInput,
} from '@stagegrid/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

const base = (slug: string) => `/projects/${encodeURIComponent(slug)}`

export const employeesQuery = (slug: string, includeArchived = false) =>
  queryOptions({
    queryKey: ['employees', slug, includeArchived],
    queryFn: () =>
      api<EmployeeDto[]>(`${base(slug)}/employees${includeArchived ? '?archived=true' : ''}`),
  })

export const useEmployees = (slug: string, includeArchived = false) =>
  useQuery(employeesQuery(slug, includeArchived))

export const taskContextQuery = (slug: string, taskId: string) =>
  queryOptions({
    queryKey: ['task-context', slug, taskId],
    queryFn: async () => {
      try {
        return await api<TaskContextDto>(`${base(slug)}/tasks/${taskId}/context`)
      } catch (e) {
        // No context pinned yet is a normal state, not an error.
        if ((e as { status?: number }).status === 404) return null
        throw e
      }
    },
  })

export function useEmployeeMutations(slug: string) {
  const queryClient = useQueryClient()
  const onSuccess = () =>
    Promise.all(
      [
        ['employees', slug],
        ['tasks', slug],
        ['task', slug],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
  return {
    create: useMutation({
      mutationFn: (
        v: Partial<CreateEmployeeInput> &
          Pick<CreateEmployeeInput, 'displayName' | 'role' | 'provider'>,
      ) => api<EmployeeDto>(`${base(slug)}/employees`, { body: v }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: (v: UpdateEmployeeInput & { id: string }) => {
        const { id, ...body } = v
        return api<EmployeeDto>(`${base(slug)}/employees/${id}`, { method: 'PATCH', body })
      },
      onSuccess,
    }),
    setArchived: useMutation({
      mutationFn: (v: { id: string; archived: boolean }) =>
        api<EmployeeDto>(`${base(slug)}/employees/${v.id}/${v.archived ? 'archive' : 'restore'}`, {
          body: {},
        }),
      onSuccess,
    }),
  }
}

export function usePinContext(slug: string, taskId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: Partial<CreateContextInput>) =>
      api<TaskContextDto>(`${base(slug)}/tasks/${taskId}/context`, { body: v }),
    onSuccess: () =>
      Promise.all(
        [
          ['task-context', slug],
          ['tasks', slug],
          ['task', slug],
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ),
  })
}
