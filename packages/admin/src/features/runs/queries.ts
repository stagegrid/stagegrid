import type { RunDto } from '@stagegrid/shared'
import { useMutation } from '@tanstack/react-query'

import { useInvalidateTasks } from '@/features/tasks/queries'
import { api } from '@/lib/api'

const base = (slug: string) => `/projects/${encodeURIComponent(slug)}`

export function useRunMutations(slug: string) {
  const invalidate = useInvalidateTasks(slug)
  const opts = { onSuccess: () => invalidate() }
  return {
    start: useMutation({
      mutationFn: (v: { taskId: string; expectedVersion: number; contextRevisionId: string }) =>
        api<RunDto>(`${base(slug)}/tasks/${v.taskId}/runs`, {
          body: {
            expectedVersion: v.expectedVersion,
            contextRevisionId: v.contextRevisionId,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      ...opts,
    }),
    cancel: useMutation({
      mutationFn: (v: { runId: string; reason?: string }) =>
        api<RunDto>(`${base(slug)}/runs/${v.runId}/cancel`, {
          body: v.reason ? { reason: v.reason } : {},
        }),
      ...opts,
    }),
  }
}
