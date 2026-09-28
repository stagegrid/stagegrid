import './doc.css'

import type { DocumentDto } from '@stagegrid/shared'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  CopyIcon,
  DownloadIcon,
  PencilIcon,
  PrinterIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ErrorState } from '@/components/page-state'
import { ProjectTabs } from '@/components/project-tabs'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api'
import { relativeTime } from '@/lib/format'

import { documentConfluence, documentHtml } from './preview'
import { renderUrl, useDocument, useDocumentMutations } from './queries'

const onError = (e: unknown) => toast.error(errorMessage(e))

export function DocumentPage({
  slug,
  docId,
  version,
}: {
  slug: string
  docId: string
  version?: number
}) {
  const { data: doc, isLoading, error, refetch } = useDocument(slug, docId, version)
  const navigate = useNavigate()
  const m = useDocumentMutations(slug, docId)
  const [editing, setEditing] = useState(false)
  const html = useMemo(() => (doc ? documentHtml(doc) : ''), [doc])

  if (isLoading) return <Skeleton className="m-6 h-96" />
  if (error || !doc) return <ErrorState error={error} onRetry={() => void refetch()} />
  const canEdit = doc.project.role !== 'viewer'
  const latest = doc.revisions[0]?.version ?? doc.version
  const viewingOld = doc.version !== latest

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon-sm" asChild aria-label="All documents">
          <Link to="/p/$slug/docs" params={{ slug }}>
            <ArrowLeftIcon />
          </Link>
        </Button>
        <h1 className="truncate text-base font-semibold" title={doc.title}>
          {doc.title}
        </h1>
        <ProjectTabs slug={slug} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={String(doc.version)}
            onValueChange={(v) =>
              void navigate({
                to: '/p/$slug/docs/$docId',
                params: { slug, docId },
                search: Number(v) === latest ? {} : { v: Number(v) },
              })
            }
          >
            <SelectTrigger size="sm" className="w-44 text-xs" aria-label="Version">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {doc.revisions.map((r) => (
                <SelectItem key={r.version} value={String(r.version)}>
                  v{r.version} · {relativeTime(r.createdAt)} · {r.by}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {viewingOld && canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                m.restore.mutate(doc.version, {
                  onError,
                  onSuccess: () =>
                    void navigate({
                      to: '/p/$slug/docs/$docId',
                      params: { slug, docId },
                      search: {},
                    }),
                })
              }
            >
              Restore this version
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <DownloadIcon />
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={renderUrl(slug, docId, 'docx', version)}>Word (.docx)</a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={renderUrl(slug, docId, 'md', version)}>Markdown</a>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  void navigator.clipboard.writeText(documentConfluence(doc).body)
                  toast('Confluence storage format copied')
                }}
              >
                <CopyIcon />
                Copy for Confluence
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/print/$slug/$docId"
              params={{ slug, docId }}
              search={version ? { v: version } : {}}
              target="_blank"
            >
              <PrinterIcon />
              Print / PDF
            </Link>
          </Button>
          {canEdit && !viewingOld && (
            <Button
              size="sm"
              variant={editing ? 'secondary' : 'outline'}
              onClick={() => setEditing(!editing)}
            >
              <PencilIcon />
              {editing ? 'Done editing' : 'Edit'}
            </Button>
          )}
          {canEdit && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete document"
              onClick={() =>
                confirm(`Delete "${doc.title}"?`) &&
                m.remove.mutate(undefined, {
                  onError,
                  onSuccess: () => void navigate({ to: '/p/$slug/docs', params: { slug } }),
                })
              }
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl p-6">
        {editing ? (
          <Editor doc={doc} onSave={(draft) => m.save.mutateAsync({ draft })} />
        ) : (
          <article className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  )
}

/** Section-by-section markdown editor; each save creates a new version (spec 06 §6). */
function Editor({
  doc,
  onSave,
}: {
  doc: DocumentDto
  onSave: (draft: DocumentDto['draft']) => Promise<unknown>
}) {
  const [sections, setSections] = useState<Record<string, string>>({
    ...(doc.draft.sections ?? {}),
  })
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      doc.resolved.fields.map((f) => {
        const v = doc.draft.fields?.[f.id]
        return [
          f.id,
          f.type === 'list'
            ? ((v as string[] | undefined) ?? []).join('\n')
            : f.type === 'table'
              ? JSON.stringify(v ?? [], null, 2)
              : ((v as string | undefined) ?? ''),
        ]
      }),
    ),
  )
  const save = async () => {
    try {
      const outFields: NonNullable<DocumentDto['draft']['fields']> = {}
      for (const f of doc.resolved.fields) {
        const raw = fields[f.id] ?? ''
        if (f.type === 'list')
          outFields[f.id] = raw
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        else if (f.type === 'table')
          outFields[f.id] = JSON.parse(raw || '[]') as Record<string, string>[]
        else outFields[f.id] = raw
      }
      await onSave({
        sections: Object.fromEntries(Object.entries(sections).filter(([, v]) => v.trim())),
        ...(doc.resolved.fields.length ? { fields: outFields } : {}),
      })
      toast('Saved as a new version')
    } catch (e) {
      onError(e)
    }
  }
  return (
    <div className="grid gap-6">
      {doc.resolved.fields.map((f) => (
        <label key={f.id} className="grid gap-1">
          <span className="text-sm font-medium">{f.label}</span>
          <span className="text-muted-foreground text-xs">
            {f.type === 'list'
              ? 'One entry per line. '
              : f.type === 'table'
                ? `JSON rows with ${f.columns?.map((c) => c.id).join(', ')}. `
                : ''}
            {f.hint}
          </span>
          <Textarea
            rows={f.type === 'text' || f.type === 'date' ? 1 : 4}
            value={fields[f.id] ?? ''}
            onChange={(e) => setFields({ ...fields, [f.id]: e.target.value })}
          />
        </label>
      ))}
      {doc.resolved.sections.map((s) => (
        <label key={s.id} className="grid gap-1">
          <span className={s.level === 1 ? 'text-base font-semibold' : 'text-sm font-medium'}>
            {s.number ? `${s.number} ${s.title}` : s.title}
          </span>
          {s.hint && <span className="text-muted-foreground text-xs">{s.hint}</span>}
          <Textarea
            rows={4}
            value={sections[s.id] ?? ''}
            onChange={(e) => setSections({ ...sections, [s.id]: e.target.value })}
            aria-label={`${s.title} content`}
          />
        </label>
      ))}
      <Button onClick={() => void save()} className="justify-self-start">
        Save new version
      </Button>
    </div>
  )
}
