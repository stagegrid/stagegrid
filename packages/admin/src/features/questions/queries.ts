import type { AttentionItemDto, QuestionBatchDto, ThreadItemDto } from '@stagegrid/shared'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useInvalidateTasks } from '@/features/tasks/queries'
import { api } from '@/lib/api'

const base = (slug: string) => `/projects/${encodeURIComponent(slug)}`

export const attentionQuery = (slug: string) =>
  queryOptions({
    queryKey: ['attention', slug],
    queryFn: () => api<AttentionItemDto[]>(`${base(slug)}/attention`),
  })
export const useAttention = (slug: string) => useQuery(attentionQuery(slug))

export const threadQuery = (slug: string, taskId: string) =>
  queryOptions({
    queryKey: ['thread', slug, taskId],
    queryFn: () => api<ThreadItemDto[]>(`${base(slug)}/tasks/${taskId}/thread`),
  })

export const batchesQuery = (slug: string, taskId: string) =>
  queryOptions({
    queryKey: ['questions', slug, taskId],
    queryFn: () => api<QuestionBatchDto[]>(`${base(slug)}/tasks/${taskId}/questions`),
  })

/** Everything a question or answer changes: the batch, the thread, the attention list, the task. */
export function useInvalidateQuestions(slug: string) {
  const queryClient = useQueryClient()
  const tasks = useInvalidateTasks(slug)
  return () =>
    Promise.all([
      tasks(),
      ...['attention', 'thread', 'questions'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key, slug] }),
      ),
    ])
}

export function useAnswerQuestion(slug: string) {
  const invalidate = useInvalidateQuestions(slug)
  return useMutation({
    mutationFn: (v: {
      questionId: string
      answer: string
      changesScope: boolean
      idempotencyKey: string
    }) =>
      api<QuestionBatchDto>(`${base(slug)}/questions/${v.questionId}/answer`, {
        body: {
          answer: v.answer,
          changesScope: v.changesScope,
          idempotencyKey: v.idempotencyKey,
        },
      }),
    onSuccess: () => invalidate(),
  })
}
