import type { QuestionDto, TaskDetailDto } from '@stagegrid/shared'
import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

import { batchesQuery, useAnswerQuestion } from './queries'

function QuestionForm({
  slug,
  question,
  canEdit,
}: {
  slug: string
  question: QuestionDto
  canEdit: boolean
}) {
  const answer = useAnswerQuestion(slug)
  const [text, setText] = useState('')
  const [scope, setScope] = useState(false)
  // One key per question, so clicking twice (or a retry) can't answer it twice.
  const key = useRef(crypto.randomUUID())
  const submit = () =>
    answer.mutate(
      {
        questionId: question.id,
        answer: text.trim(),
        changesScope: scope,
        idempotencyKey: key.current,
      },
      { onError: (e) => toast.error(errorMessage(e)) },
    )
  return (
    <li className="grid gap-2 rounded-md border p-2 text-sm">
      <p className="font-medium break-words">{question.prompt}</p>
      {question.state === 'answered' ? (
        <p className="text-muted-foreground text-xs break-words">
          {question.answeredBy?.name ?? 'Someone'}: {question.answer}
          {question.changesScope && ' · changes what was agreed'}
        </p>
      ) : question.state === 'cancelled' ? (
        <Badge variant="outline">Cancelled</Badge>
      ) : canEdit ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) submit()
          }}
        >
          {question.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Suggested answers">
              {question.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setText(o)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs',
                    text === o ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <Textarea
            aria-label={`Answer to: ${question.prompt}`}
            rows={2}
            value={text}
            maxLength={5000}
            onChange={(e) => setText(e.target.value)}
          />
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={scope} onCheckedChange={(v) => setScope(v === true)} />
            This changes what was agreed
          </label>
          <Button
            type="submit"
            size="sm"
            className="justify-self-start"
            disabled={!text.trim() || answer.isPending}
          >
            Answer
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-xs">Waiting for an answer.</p>
      )}
    </li>
  )
}

/** The employee's questions for this task, with a form for each open one. */
export function QuestionPanel({
  slug,
  task,
  canEdit,
}: {
  slug: string
  task: TaskDetailDto
  canEdit: boolean
}) {
  const { data: batches = [] } = useQuery({
    ...batchesQuery(slug, task.id),
    enabled: !!task.employee,
  })
  const current = batches.find((b) => b.state === 'open') ?? batches.find((b) => b.holdForContext)
  if (!current) return null
  const open = current.questions.filter((q) => q.state === 'open').length
  return (
    <section className="grid gap-2" aria-label="Questions">
      <h3 className="text-muted-foreground text-xs font-medium uppercase">
        Questions{open > 0 ? ` · ${open} to answer` : ''}
      </h3>
      {current.holdForContext && (
        <p role="status" className="bg-muted rounded-md p-2 text-xs">
          An answer changes what was agreed. {task.employee?.displayName ?? 'The employee'}{' '}
          continues once you pin the updated context.
        </p>
      )}
      {current.state === 'open' && task.employee && (
        <p className="text-muted-foreground text-xs">
          {task.employee.displayName} is waiting. Work continues once every question is answered.
        </p>
      )}
      <ul className="grid gap-2">
        {current.questions.map((q) => (
          <QuestionForm key={q.id} slug={slug} question={q} canEdit={canEdit} />
        ))}
      </ul>
    </section>
  )
}
