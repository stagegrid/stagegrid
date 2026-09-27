import type {
  BoardDto,
  CellDetailDto,
  ChangeInput,
  ChangesResultDto,
  LinkKind,
} from '@stagegrid/shared'
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
      queryClient.invalidateQueries({ queryKey: ['timeline', slug] }),
      queryClient.invalidateQueries({ queryKey: ['burnup', slug] }),
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

/** Mutations for one cell's details; all refresh the board and the cell. */
export function useCellMutations(
  slug: string,
  cell: { cellId: string; itemId: string; stageId: string },
) {
  const invalidate = useInvalidateProject(slug)
  const base = `/projects/${encodeURIComponent(slug)}`
  const onSuccess = () => invalidate()
  const change = (fields: Omit<ChangeInput, 'item' | 'stage'>) =>
    api<ChangesResultDto>(`${base}/changes`, {
      body: { changes: [{ item: cell.itemId, stage: cell.stageId, ...fields }] },
    })
  return {
    setAssignees: useMutation({
      mutationFn: (assignees: ({ userId: string } | { name: string })[]) => change({ assignees }),
      onSuccess,
    }),
    setPlanned: useMutation({
      mutationFn: (p: { plannedStart: string | null; plannedEnd: string | null }) => change(p),
      onSuccess,
    }),
    addComment: useMutation({
      mutationFn: (body: string) =>
        api(`${base}/cells/${cell.cellId}/comments`, { body: { body } }),
      onSuccess,
    }),
    editComment: useMutation({
      mutationFn: (v: { id: string; body: string }) =>
        api(`${base}/comments/${v.id}`, { method: 'PATCH', body: { body: v.body } }),
      onSuccess,
    }),
    deleteComment: useMutation({
      mutationFn: (id: string) => api(`${base}/comments/${id}`, { method: 'DELETE' }),
      onSuccess,
    }),
    addLink: useMutation({
      mutationFn: (link: { title: string; url: string; kind: LinkKind }) =>
        api(`${base}/cells/${cell.cellId}/links`, { body: link }),
      onSuccess,
    }),
    deleteLink: useMutation({
      mutationFn: (id: string) => api(`${base}/links/${id}`, { method: 'DELETE' }),
      onSuccess,
    }),
    moveEvent: useMutation({
      mutationFn: (v: { id: string; happenedAt: string }) =>
        api(`${base}/events/${v.id}`, { method: 'PATCH', body: { happenedAt: v.happenedAt } }),
      onSuccess,
    }),
    deleteEvent: useMutation({
      mutationFn: (id: string) => api(`${base}/events/${id}`, { method: 'DELETE' }),
      onSuccess,
    }),
  }
}
