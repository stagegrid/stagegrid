import type { TaskDetailDto } from '@stagegrid/shared'
import { useMutation } from '@tanstack/react-query'

import { useInvalidateTasks } from '@/features/tasks/queries'
import { api } from '@/lib/api'

export function useAcceptTask(slug: string) {
  const invalidate = useInvalidateTasks(slug)
  return useMutation({
    mutationFn: (v: {
      taskId: string
      expectedVersion: number
      submissionId: string
      headCommit: string
      contextRevisionId: string
      idempotencyKey: string
      acknowledgeFailing: boolean
    }) => {
      const { taskId, ...body } = v
      return api<TaskDetailDto>(`/projects/${encodeURIComponent(slug)}/tasks/${taskId}/accept`, {
        body,
      })
    },
    onSuccess: () => invalidate(),
  })
}
