import type { BoardDto, CellDetailDto, ChangeInput, ChangesResultDto } from '@stagegrid/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { qk } from '@/lib/query-keys'

export const boardQuery = (slug: string) =>
  queryOptions({
    queryKey: qk.board(slug),
    queryFn: () => api<BoardDto>(`/projects/${encodeURIComponent(slug)}/board`),
  })

export const useBoard = (slug: string) => useQuery(boardQuery(slug))

export const cellQuery = (slug: string, cellId: string) =>
  queryOptions({
    queryKey: qk.cell(slug, cellId),
    queryFn: () => api<CellDetailDto>(`/projects/${encodeURIComponent(slug)}/cells/${cellId}`),
  })

/** Invalidate everything that depends on a project's cells. */
export function useInvalidateProject(slug: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.board(slug) }),
      queryClient.invalidateQueries({ queryKey: ['cell', slug] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    ])
}

export function useApplyChanges(slug: string) {
  const invalidate = useInvalidateProject(slug)
  return useMutation({
    mutationFn: (changes: ChangeInput[]) =>
      api<ChangesResultDto>(`/projects/${encodeURIComponent(slug)}/changes`, { body: { changes } }),
    onSuccess: () => invalidate(),
  })
}

export function useItemMutations(slug: string) {
  const invalidate = useInvalidateProject(slug)
  const base = `/projects/${encodeURIComponent(slug)}/items`
  const opts = { onSuccess: () => invalidate() }
  return {
    create: useMutation({
      mutationFn: (input: { parent?: string | null; after?: string; items: { name: string }[] }) =>
        api<{ items: { id: string; path: string }[] }>(base, { body: input }),
      ...opts,
    }),
    rename: useMutation({
      mutationFn: (v: { id: string; name: string }) =>
        api(`${base}/${v.id}`, { method: 'PATCH', body: { name: v.name } }),
      ...opts,
    }),
    move: useMutation({
      mutationFn: (v: { id: string; parent?: string | null; before?: string; after?: string }) =>
        api(`${base}/${v.id}/move`, {
          body: { parent: v.parent, before: v.before, after: v.after },
        }),
      ...opts,
    }),
    remove: useMutation({
      mutationFn: (id: string) =>
        api<{ deletedCount: number }>(`${base}/${id}`, { method: 'DELETE' }),
      ...opts,
    }),
  }
}
