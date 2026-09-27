import type { ReleaseDetailDto, ReleasePhaseInput, ReleaseSummaryDto } from '@stagegrid/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

const base = (slug: string) => `/projects/${encodeURIComponent(slug)}/releases`

export const releasesQuery = (slug: string, status?: 'active' | 'released' | 'cancelled') =>
  queryOptions({
    queryKey: ['releases', slug, status ?? 'all'],
    queryFn: () => api<ReleaseSummaryDto[]>(`${base(slug)}${status ? `?status=${status}` : ''}`),
  })

export const releaseQuery = (slug: string, id: string) =>
  queryOptions({
    queryKey: ['release', slug, id],
    queryFn: () => api<ReleaseDetailDto>(`${base(slug)}/${encodeURIComponent(id)}`),
  })

export const useReleases = (slug: string, status?: 'active' | 'released' | 'cancelled') =>
  useQuery(releasesQuery(slug, status))
export const useRelease = (slug: string, id: string | undefined) =>
  useQuery({ ...releaseQuery(slug, id ?? ''), enabled: !!id })

export interface AddItemsResult {
  dryRun: boolean
  added: { item: string; kind: 'new' | 'change'; cells: number }[]
  reopened: { item: string; stage: string }[]
}

export function useReleaseMutations(slug: string, id: string) {
  const queryClient = useQueryClient()
  const url = `${base(slug)}/${encodeURIComponent(id)}`
  const onSuccess = () =>
    Promise.all(
      [
        ['releases', slug],
        ['release', slug],
        ['board', slug],
        ['timeline', slug],
        ['projects'],
        ['cell', slug],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
  return {
    update: useMutation({
      mutationFn: (v: { name?: string; targetDate?: string; description?: string }) =>
        api<ReleaseDetailDto>(url, { method: 'PATCH', body: v }),
      onSuccess,
    }),
    setPhases: useMutation({
      mutationFn: (phases: ReleasePhaseInput[]) =>
        api<ReleaseDetailDto>(`${url}/phases`, { method: 'PUT', body: { phases } }),
      onSuccess,
    }),
    addItems: useMutation({
      mutationFn: (v: {
        items: { item: string; kind: 'new' | 'change'; stages?: string[]; note?: string }[]
        dryRun: boolean
      }) => api<AddItemsResult>(`${url}/items`, { body: v }),
      onSuccess: (res) => (res.dryRun ? undefined : onSuccess()),
    }),
    setNote: useMutation({
      mutationFn: (v: { itemId: string; note: string | null }) =>
        api(`${url}/items/${v.itemId}`, { method: 'PATCH', body: { note: v.note } }),
      onSuccess,
    }),
    removeItem: useMutation({
      mutationFn: (itemId: string) => api(`${url}/items/${itemId}`, { method: 'DELETE' }),
      onSuccess,
    }),
    release: useMutation({
      mutationFn: (force: boolean) => api<ReleaseDetailDto>(`${url}/release`, { body: { force } }),
      onSuccess,
    }),
    cancel: useMutation({ mutationFn: () => api(`${url}/cancel`, { body: {} }), onSuccess }),
    remove: useMutation({ mutationFn: () => api(url, { method: 'DELETE' }), onSuccess }),
  }
}

export function useCreateRelease(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { name: string; targetDate: string; description: string }) =>
      api<ReleaseDetailDto>(base(slug), { body: v }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['releases', slug] }),
  })
}
