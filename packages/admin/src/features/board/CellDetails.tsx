import type { BoardDto, CellDetailDto, LinkKind } from '@stagegrid/shared'
import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import { useState } from 'react'
import Markdown from 'react-markdown'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useMe } from '@/features/auth/queries'
import { membersQuery } from '@/features/settings/queries'
import { errorMessage } from '@/lib/api'
import { relativeTime } from '@/lib/format'

import type { OpenCell } from './CellPopover'
import { useCellMutations } from './queries'

const onError = (e: unknown) => toast.error(errorMessage(e))

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 border-t pt-3">
      <h3 className="text-muted-foreground text-xs font-medium uppercase">{title}</h3>
      {children}
    </div>
  )
}

function Assignees({
  board,
  open,
  detail,
  canEdit,
}: {
  board: BoardDto
  open: OpenCell
  detail: CellDetailDto
  canEdit: boolean
}) {
  const { data: members = [] } = useQuery(membersQuery(board.project.slug))
  const { setAssignees } = useCellMutations(board.project.slug, open)
  const [text, setText] = useState('')
  const current = detail.assignees
  const toInput = (list: typeof current) =>
    list.map((a) => (a.userId ? { userId: a.userId } : { name: a.name }))
  const save = (list: ReturnType<typeof toInput>) => setAssignees.mutate(list, { onError })
  const q = text.trim().toLowerCase()
  const suggestions = q
    ? members
        .filter(
          (m) => m.name.toLowerCase().includes(q) && !current.some((a) => a.userId === m.userId),
        )
        .slice(0, 5)
    : []

  return (
    <Section title="Assignees">
      <div className="flex flex-wrap gap-1">
        {current.length === 0 && <span className="text-muted-foreground text-xs">No one yet.</span>}
        {current.map((a, i) => (
          <Badge key={a.userId ?? a.name} variant="secondary" className="gap-1">
            {a.name}
            {canEdit && (
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => save(toInput(current.filter((_, j) => j !== i)))}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {canEdit && (
        <div className="relative">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !text.trim()) return
              e.preventDefault()
              e.stopPropagation()
              const m = suggestions[0]
              save([...toInput(current), m ? { userId: m.userId } : { name: text.trim() }])
              setText('')
            }}
            placeholder="Add a member or type a name"
            aria-label="Add assignee"
            className="h-8"
          />
          {text.trim() && (
            <ul className="bg-popover absolute inset-x-0 top-9 z-10 rounded-md border p-1 text-sm shadow-md">
              {suggestions.map((m) => (
                <li key={m.userId}>
                  <button
                    type="button"
                    className="hover:bg-accent w-full rounded px-2 py-1 text-left"
                    onClick={() => {
                      save([...toInput(current), { userId: m.userId }])
                      setText('')
                    }}
                  >
                    {m.name} <span className="text-muted-foreground text-xs">{m.email}</span>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="hover:bg-accent w-full rounded px-2 py-1 text-left"
                  onClick={() => {
                    save([...toInput(current), { name: text.trim() }])
                    setText('')
                  }}
                >
                  Add “{text.trim()}”
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

function Planned({
  board,
  open,
  detail,
  canEdit,
}: {
  board: BoardDto
  open: OpenCell
  detail: CellDetailDto
  canEdit: boolean
}) {
  const { setPlanned } = useCellMutations(board.project.slug, open)
  const save = (start: string, end: string) =>
    setPlanned.mutate({ plannedStart: start || null, plannedEnd: end || null }, { onError })
  return (
    <Section title="Planned">
      <div className="flex items-center gap-2">
        <Input
          type="date"
          aria-label="Planned start"
          defaultValue={detail.plannedStart ?? ''}
          disabled={!canEdit}
          onBlur={(e) =>
            e.target.value !== (detail.plannedStart ?? '') &&
            save(e.target.value, detail.plannedEnd ?? '')
          }
          className="h-8"
        />
        <span className="text-muted-foreground text-xs">to</span>
        <Input
          type="date"
          aria-label="Planned end"
          defaultValue={detail.plannedEnd ?? ''}
          disabled={!canEdit}
          onBlur={(e) =>
            e.target.value !== (detail.plannedEnd ?? '') &&
            save(detail.plannedStart ?? '', e.target.value)
          }
          className="h-8"
        />
      </div>
    </Section>
  )
}

function Links({
  board,
  open,
  detail,
  canEdit,
}: {
  board: BoardDto
  open: OpenCell
  detail: CellDetailDto
  canEdit: boolean
}) {
  const { addLink, deleteLink } = useCellMutations(board.project.slug, open)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<LinkKind>('doc')
  return (
    <Section title="Links">
      {detail.links.length === 0 && !adding && (
        <span className="text-muted-foreground text-xs">No links.</span>
      )}
      <ul className="grid gap-1">
        {detail.links.map((l) => (
          <li key={l.id} className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="h-4 px-1 text-[10px] uppercase">
              {l.kind}
            </Badge>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate hover:underline"
            >
              {l.title}
              <ExternalLinkIcon className="ml-1 inline size-3" />
            </a>
            {canEdit && (
              <button
                type="button"
                aria-label={`Remove link ${l.title}`}
                onClick={() => deleteLink.mutate(l.id, { onError })}
              >
                <XIcon className="text-muted-foreground size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit &&
        (adding ? (
          <form
            className="grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              addLink.mutate(
                { title: title.trim(), url: url.trim(), kind },
                {
                  onError,
                  onSuccess: () => {
                    setAdding(false)
                    setTitle('')
                    setUrl('')
                  },
                },
              )
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="SRS v2"
              aria-label="Link title"
              className="h-8"
            />
            <div className="flex gap-1.5">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                aria-label="Link URL"
                className="h-8"
              />
              <Select value={kind} onValueChange={(v) => setKind(v as LinkKind)}>
                <SelectTrigger size="sm" className="w-24" aria-label="Link kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['doc', 'design', 'issue', 'other'] as const).map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1.5">
              <Button type="submit" size="sm" disabled={!title.trim() || !url.trim()}>
                Add link
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => setAdding(true)}
          >
            Add link
          </Button>
        ))}
    </Section>
  )
}

function Comments({
  board,
  open,
  detail,
  canEdit,
}: {
  board: BoardDto
  open: OpenCell
  detail: CellDetailDto
  canEdit: boolean
}) {
  const { data: me } = useMe()
  const { addComment, editComment, deleteComment } = useCellMutations(board.project.slug, open)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const isOwner = board.project.role === 'owner'
  return (
    <Section title="Comments">
      <ul className="grid gap-2">
        {detail.comments.map((c) => (
          <li key={c.id} className="grid gap-0.5 text-sm">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span className="text-foreground font-medium">{c.author.name}</span>
              <span>{relativeTime(c.createdAt)}</span>
              {c.editedAt && <span>(edited)</span>}
              {canEdit && (c.author.userId === me?.id || isOwner) && (
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    aria-label="Edit comment"
                    onClick={() => setEditing({ id: c.id, body: c.body })}
                  >
                    <PencilIcon className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete comment"
                    onClick={() => deleteComment.mutate(c.id, { onError })}
                  >
                    <Trash2Icon className="size-3" />
                  </button>
                </span>
              )}
            </div>
            {editing?.id === c.id ? (
              <div className="grid gap-1">
                <Textarea
                  rows={3}
                  value={editing.body}
                  onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                  aria-label="Edit comment text"
                />
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() =>
                      editComment.mutate(editing, { onError, onSuccess: () => setEditing(null) })
                    }
                    disabled={!editing.body.trim()}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose-sm [&_code]:bg-muted [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4">
                <Markdown>{c.body}</Markdown>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="grid gap-1">
          <Textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note (markdown)"
            aria-label="New comment"
            onKeyDown={(e) => e.stopPropagation()}
          />
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            disabled={!draft.trim() || addComment.isPending}
            onClick={() =>
              addComment.mutate(draft.trim(), { onError, onSuccess: () => setDraft('') })
            }
          >
            Comment
          </Button>
        </div>
      )}
    </Section>
  )
}

export function CellDetails(props: {
  board: BoardDto
  open: OpenCell
  detail: CellDetailDto
  canEdit: boolean
}) {
  return (
    <>
      <Assignees {...props} />
      <Planned key={`${props.detail.plannedStart}-${props.detail.plannedEnd}`} {...props} />
      <Links {...props} />
      <Comments {...props} />
    </>
  )
}
