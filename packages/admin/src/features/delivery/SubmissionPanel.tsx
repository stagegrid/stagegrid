import type { CheckDto, TaskDetailDto } from '@stagegrid/shared'
import { Link } from '@tanstack/react-router'
import { CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { errorMessage } from '@/lib/api'
import { formatDateTime } from '@/lib/format'

import { useAcceptTask } from './queries'

const SOURCE_LABEL: Record<CheckDto['source'], string> = {
  agent_reported: "The agent's own word",
  runner_reported: 'Run by the runner',
  ci_checked: 'Checked by CI',
}

const STATE_LABEL = {
  submitted: 'Waiting for your decision',
  accepted: 'Accepted',
  superseded: 'Replaced by a newer delivery',
  changes_requested: 'Sent back for changes',
} as const

/**
 * What the employee delivered and how well it is backed up. Accepting is tied to this exact commit;
 * it finishes the task and does not merge anything.
 */
export function SubmissionPanel({
  slug,
  task,
  timezone,
  canEdit,
}: {
  slug: string
  task: TaskDetailDto
  timezone: string
  canEdit: boolean
}) {
  const sub = task.submission
  const accept = useAcceptTask(slug)
  const [confirming, setConfirming] = useState(false)
  const [anyway, setAnyway] = useState(false)
  const key = useRef(crypto.randomUUID())
  if (!sub) return null

  const failing = sub.evidence.failing > 0
  const outdated = !!task.context && task.context.revisionId !== sub.contextRevisionId
  const short = sub.headCommit.slice(0, 7)
  const waiting = sub.state === 'submitted' && task.state === 'ready_for_acceptance'

  return (
    <section className="grid gap-2" aria-label="Delivery">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-muted-foreground text-xs font-medium uppercase">Delivery</h3>
        <Badge variant={waiting ? 'default' : 'secondary'}>{STATE_LABEL[sub.state]}</Badge>
      </div>
      <p className="text-xs">
        {task.role === 'analyst' ? 'Version' : 'Commit'}{' '}
        <code className="bg-muted rounded px-1">
          {task.role === 'analyst' ? sub.artifacts[0]?.version : short}
        </code>
        {sub.decidedAt && (
          <span className="text-muted-foreground">
            {' '}
            · {sub.decidedBy ?? 'Someone'} {formatDateTime(sub.decidedAt, timezone)}
          </span>
        )}
      </p>
      {sub.summary && <p className="text-sm break-words whitespace-pre-wrap">{sub.summary}</p>}
      <ul className="grid gap-1 text-xs">
        {sub.artifacts.map((a) => (
          <li key={a.artifactId} className="flex flex-wrap items-center gap-1.5">
            {a.kind === 'pull_request' && a.url ? (
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2"
              >
                Pull request <ExternalLinkIcon className="size-3" />
              </a>
            ) : a.kind === 'document' && a.documentId ? (
              <Link
                to="/p/$slug/docs/$docId"
                params={{ slug, docId: a.documentId }}
                className="underline underline-offset-2"
              >
                Requirement document, version {a.version}
              </Link>
            ) : a.kind === 'branch' ? (
              <span>
                Branch <code className="bg-muted rounded px-1">{a.branch}</code> pushed to {a.repo}
              </span>
            ) : (
              <span>Commit on this machine only: nothing was pushed</span>
            )}
          </li>
        ))}
      </ul>
      {sub.reviews.map((r) => (
        <div
          key={r.id}
          role="region"
          className="grid gap-1 rounded-md border p-2 text-xs"
          aria-label={r.role === 'qa' ? 'QA report' : 'Review'}
        >
          <p className="font-medium">
            {r.role === 'qa' ? 'QA' : 'Reviewer'}:{' '}
            {r.verdict === 'pass'
              ? 'passed'
              : r.verdict === 'fail'
                ? 'failed'
                : 'asked for changes'}
            <span className="text-muted-foreground font-normal"> · advice, you decide</span>
          </p>
          {r.summary && <p className="break-words">{r.summary}</p>}
          {r.results.length > 0 && (
            <ul className="grid gap-0.5">
              {r.results.map((x, i) => (
                <li key={i} className="break-words">
                  {x.result === 'pass' ? '✓' : x.result === 'fail' ? '✗' : '–'} {x.criterion}
                  {x.evidence && <span className="text-muted-foreground"> · {x.evidence}</span>}
                </li>
              ))}
            </ul>
          )}
          {r.findings.length > 0 && (
            <ul className="grid gap-0.5">
              {r.findings.map((f, i) => (
                <li key={i} className="break-words">
                  <span className="font-medium">{f.severity}</span> {f.text}
                  {f.file && <code className="bg-muted ml-1 rounded px-1">{f.file}</code>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {sub.reviewState === 'pending' && (
        <p className="text-muted-foreground text-xs">Waiting for the Reviewer.</p>
      )}
      <div className="grid gap-1" aria-label="Evidence">
        <p className="text-muted-foreground text-xs font-medium">Checks on this commit</p>
        {sub.checks.length === 0 && <p className="text-xs">No checks were reported.</p>}
        <ul className="grid gap-1 text-xs">
          {sub.checks.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5">
              {c.exitCode === 0 ? (
                <CheckIcon className="mt-0.5 size-3.5 shrink-0" aria-label="Passed" />
              ) : (
                <XIcon className="text-destructive mt-0.5 size-3.5 shrink-0" aria-label="Failed" />
              )}
              <span className="min-w-0 break-words">
                {c.command}
                <span className="text-muted-foreground"> · {SOURCE_LABEL[c.source]}</span>
              </span>
            </li>
          ))}
        </ul>
        {sub.evidence.strongest === 'agent_reported' && (
          <p className="text-muted-foreground text-xs">
            Only the agent says its tests pass. Nothing independent was run.
          </p>
        )}
      </div>
      {outdated && waiting && (
        <p role="status" className="bg-muted rounded-md p-2 text-xs">
          The context changed after this was built. You are accepting the work against the context
          it was built from.
        </p>
      )}

      {waiting && canEdit && !confirming && (
        <Button size="sm" className="justify-self-start" onClick={() => setConfirming(true)}>
          Accept this version
        </Button>
      )}
      {waiting && canEdit && confirming && (
        <div className="grid gap-2 rounded-md border p-2 text-xs">
          <p>
            Accept commit <code className="bg-muted rounded px-1">{short}</code>? This marks the
            task done. It doesn't merge anything.
          </p>
          {failing && (
            <label className="flex items-center gap-2">
              <Checkbox checked={anyway} onCheckedChange={(v) => setAnyway(v === true)} />
              {sub.evidence.failing} check{sub.evidence.failing === 1 ? '' : 's'} failed. Accept
              anyway.
            </label>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={accept.isPending || (failing && !anyway)}
              onClick={() =>
                accept.mutate(
                  {
                    taskId: task.id,
                    expectedVersion: task.version,
                    submissionId: sub.id,
                    headCommit: sub.headCommit,
                    contextRevisionId: sub.contextRevisionId,
                    idempotencyKey: key.current,
                    acknowledgeFailing: anyway,
                  },
                  {
                    onSuccess: () => setConfirming(false),
                    onError: (e) => {
                      setConfirming(false)
                      toast.error(errorMessage(e))
                    },
                  },
                )
              }
            >
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
