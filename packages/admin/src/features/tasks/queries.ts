import type {
  BoardTaskDto,
  CreateTaskInput,
  TaskActionInput,
  TaskDetailDto,
  UpdateTaskInput,
} from '@stagegrid/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

const base = (slug: string) => `/projects/${encodeURIComponent(slug)}`

export const tasksQuery = (slug: string, cellId?: string) =>
  queryOptions({
    queryKey: ['tasks', slug, cellId ?? 'all'],
    queryFn: () =>
      api<BoardTaskDto[]>(
        `${base(slug)}/tasks${cellId ? `?cellId=${encodeURIComponent(cellId)}` : ''}`,
      ),
  })

export const useTasks = (slug: string, cellId?: string) => useQuery(tasksQuery(slug, cellId))

export const taskQuery = (slug: string, id: string) =>
  queryOptions({
    queryKey: ['task', slug, id],
    queryFn: () => api<TaskDetailDto>(`${base(slug)}/tasks/${encodeURIComponent(id)}`),
  })

/** Tasks move cells (and so the board, stats and timeline); refresh everything that shows them. */
export function useInvalidateTasks(slug: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all(
      [
        ['tasks', slug],
        ['task', slug],
        ['board', slug],
        ['cell', slug],
        ['timeline', slug],
        ['burnup', slug],
        ['projects'],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
}

export function useTaskMutations(slug: string) {
  const invalidate = useInvalidateTasks(slug)
  const opts = { onSuccess: () => invalidate() }
  return {
    create: useMutation({
      mutationFn: (v: Partial<CreateTaskInput> & Pick<CreateTaskInput, 'cellId' | 'title'>) =>
        api<TaskDetailDto>(`${base(slug)}/tasks`, { body: v }),
      ...opts,
    }),
    update: useMutation({
      mutationFn: (v: UpdateTaskInput & { id: string }) => {
        const { id, ...body } = v
        return api<TaskDetailDto>(`${base(slug)}/tasks/${id}`, { method: 'PATCH', body })
      },
      ...opts,
    }),
    act: useMutation({
      mutationFn: (v: TaskActionInput & { id: string }) => {
        const { id, ...body } = v
        return api<TaskDetailDto>(`${base(slug)}/tasks/${id}/actions`, { body })
      },
      ...opts,
    }),
    setMode: useMutation({
      mutationFn: (v: { cellId: string; mode: 'manual' | 'tasks' }) =>
        api(`${base(slug)}/cells/${v.cellId}/progress-mode`, {
          method: 'PUT',
          body: { mode: v.mode },
        }),
      ...opts,
    }),
  }
}
