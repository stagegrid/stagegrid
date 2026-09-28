import type { DocTemplateDto, DocumentDto, DocumentSummaryDto } from '@stagegrid/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

const p = (slug: string) => `/projects/${encodeURIComponent(slug)}`

export const documentsQuery = (slug: string) =>
  queryOptions({
    queryKey: ['documents', slug],
    queryFn: () => api<DocumentSummaryDto[]>(`${p(slug)}/documents`),
  })

export const documentQuery = (slug: string, id: string, version?: number) =>
  queryOptions({
    queryKey: ['document', slug, id, version ?? 'latest'],
    queryFn: () => api<DocumentDto>(`${p(slug)}/documents/${id}${version ? `?v=${version}` : ''}`),
  })

export const projectTemplatesQuery = (slug: string) =>
  queryOptions({
    queryKey: ['doc-templates', slug],
    queryFn: () => api<(DocTemplateDto & { selected: boolean })[]>(`${p(slug)}/doc-templates`),
  })

export const useDocuments = (slug: string) => useQuery(documentsQuery(slug))
export const useDocument = (slug: string, id: string, version?: number) =>
  useQuery(documentQuery(slug, id, version))

export function useDocumentMutations(slug: string, id: string) {
  const queryClient = useQueryClient()
  const onSuccess = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['document', slug, id] }),
      queryClient.invalidateQueries({ queryKey: ['documents', slug] }),
      queryClient.invalidateQueries({ queryKey: ['board', slug] }),
    ])
  return {
    save: useMutation({
      mutationFn: (v: { draft: DocumentDto['draft']; title?: string }) =>
        api(`${p(slug)}/documents/${id}`, { method: 'PATCH', body: v }),
      onSuccess,
    }),
    restore: useMutation({
      mutationFn: (version: number) =>
        api(`${p(slug)}/documents/${id}/revisions/${version}/restore`, { body: {} }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: () => api(`${p(slug)}/documents/${id}`, { method: 'DELETE' }),
      onSuccess,
    }),
  }
}

export const renderUrl = (
  slug: string,
  id: string,
  format: 'docx' | 'md' | 'confluence',
  version?: number,
) => `/api/v1${p(slug)}/documents/${id}/render?format=${format}${version ? `&v=${version}` : ''}`
