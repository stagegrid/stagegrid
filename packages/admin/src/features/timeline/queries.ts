import type { BurnupDto, TimelineDto } from '@stagegrid/shared'
import { queryOptions, useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export const timelineQuery = (slug: string) =>
  queryOptions({
    queryKey: ['timeline', slug],
    queryFn: () => api<TimelineDto>(`/projects/${encodeURIComponent(slug)}/timeline`),
  })

export const burnupQuery = (slug: string) =>
  queryOptions({
    queryKey: ['burnup', slug],
    queryFn: () => api<BurnupDto>(`/projects/${encodeURIComponent(slug)}/burnup`),
  })

export const useTimeline = (slug: string) => useQuery(timelineQuery(slug))
export const useBurnup = (slug: string) => useQuery(burnupQuery(slug))
