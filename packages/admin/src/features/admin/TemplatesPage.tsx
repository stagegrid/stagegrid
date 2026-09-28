import type { DocTemplateDto } from '@stagegrid/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownIcon, ArrowUpIcon, FileUpIcon, PlusIcon, XIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { ErrorState, PageHeader } from '@/components/page-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, errorMessage } from '@/lib/api'

interface Section {
  id: string
  title: string
  level: 1 | 2 | 3
  hint: string
  repeat?: { source: 'items'; depth: 1 | 2 } | { source: 'release_items'; kind?: 'new' | 'change' }
}
type Level = DocTemplateDto['level']
type Detail = DocTemplateDto & {
  schema: { kind: 'narrative' | 'form'; sections?: Section[]; fields?: unknown[] }
}

const onError = (e: unknown) => toast.error(errorMessage(e))

async function upload(path: string, method: 'POST' | 'PUT', file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/v1${path}`, { method, body: form, credentials: 'same-origin' })
  const data = (await res.json().catch(() => null)) as {
    error?: { code: never; message: string }
  } | null
  if (!res.ok)
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'internal',
      data?.error?.message ?? 'Upload failed',
    )
  return data
}

/** Renumber sections from their levels: 1, 1.1, 1.1.1, 2… (ids of repeat sections too). */
function renumber(sections: Section[]): Section[] {
  const c = [0, 0, 0]
  return sections.map((s) => {
    c[s.level - 1]! += 1
    for (let i = s.level; i < 3; i++) c[i] = 0
    return {
      ...s,
      id: c
        .slice(0, s.level)
        .map((n) => Math.max(n, 1))
        .join('.'),
    }
  })
}

export function TemplatesPage() {
  const queryClient = useQueryClient()
  const {
    data: templates,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin-templates'],
    queryFn: () => api<DocTemplateDto[]>('/admin/templates'),
  })
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-templates'] })
  const archive = useMutation({
    mutationFn: (t: DocTemplateDto) =>
      api(`/admin/templates/${t.key}`, { method: 'PATCH', body: { archived: !t.archived } }),
    onSuccess: refresh,
    onError,
  })

  return (
    <div>
      <PageHeader
        title="Document templates"
        description="Your AI writes documents from these; Stagegrid renders them to Word, PDF, Markdown, and Confluence."
        actions={
          <Button onClick={() => setEditing('new')}>
            <PlusIcon />
            New template
          </Button>
        }
      />
      <div className="p-6">
        {isLoading && <Skeleton className="h-40" />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {templates && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>For</TableHead>
                <TableHead>Parts</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id} className={t.archived ? 'opacity-50' : undefined}>
                  <TableCell>
                    {t.name} {t.builtin && <Badge variant="secondary">Built-in</Badge>}{' '}
                    {t.hasBaseDocx && <Badge variant="outline">Word base</Badge>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.key}</TableCell>
                  <TableCell className="capitalize">{t.level}</TableCell>
                  <TableCell>{t.sectionCount}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(t.key)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => archive.mutate(t)}>
                      {t.archived ? 'Restore' : 'Archive'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {editing && (
        <TemplateDialog
          templateKey={editing === 'new' ? null : editing}
          onClose={() => (setEditing(null), void refresh())}
        />
      )}
    </div>
  )
}

function TemplateDialog({
  templateKey,
  onClose,
}: {
  templateKey: string | null
  onClose: () => void
}) {
  const { data: detail } = useQuery({
    queryKey: ['admin-template', templateKey],
    queryFn: () => api<Detail>(`/admin/templates/${templateKey}`),
    enabled: !!templateKey,
  })
  const loaded = !templateKey || detail
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{templateKey ? `Edit ${detail?.name ?? ''}` : 'New template'}</DialogTitle>
          <DialogDescription>
            Hints tell the AI what each section must contain; they are not printed.
          </DialogDescription>
        </DialogHeader>
        {loaded ? (
          <TemplateForm key={detail?.id ?? 'new'} detail={detail ?? null} onDone={onClose} />
        ) : (
          <Skeleton className="h-60" />
        )}
      </DialogContent>
    </Dialog>
  )
}

function TemplateForm({ detail, onDone }: { detail: Detail | null; onDone: () => void }) {
  const [key, setKey] = useState(detail?.key ?? '')
  const [name, setName] = useState(detail?.name ?? '')
  const [level, setLevel] = useState<Level>(detail?.level ?? 'project')
  const [kind, setKind] = useState<'narrative' | 'form'>(detail?.schema.kind ?? 'narrative')
  const [sections, setSections] = useState<Section[]>(
    detail?.schema.sections ?? [{ id: '1', title: 'Introduction', level: 1, hint: '' }],
  )
  const [formJson, setFormJson] = useState(() =>
    JSON.stringify(
      {
        fields: detail?.schema.fields ?? [],
        sections: detail?.schema.kind === 'form' ? (detail.schema.sections ?? []) : [],
      },
      null,
      2,
    ),
  )
  const importRef = useRef<HTMLInputElement>(null)
  const baseRef = useRef<HTMLInputElement>(null)
  const locked = !!detail?.builtin
  const set = (i: number, patch: Partial<Section>) =>
    setSections((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const move = (i: number, d: -1 | 1) =>
    setSections((ss) => {
      const next = [...ss]
      const [x] = next.splice(i, 1)
      next.splice(i + d, 0, x!)
      return next
    })

  const save = async () => {
    try {
      const schema =
        kind === 'narrative'
          ? { kind, sections: renumber(sections) }
          : { kind, ...(JSON.parse(formJson) as object) }
      if (detail)
        await api(`/admin/templates/${detail.key}`, {
          method: 'PATCH',
          body: locked ? { name } : { name, level, schema },
        })
      else await api('/admin/templates', { body: { key, name, level, schema } })
      toast('Template saved')
      onDone()
    } catch (e) {
      onError(e)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input
          aria-label="Key"
          placeholder="screen-spec"
          value={key}
          disabled={!!detail}
          onChange={(e) => setKey(e.target.value.toLowerCase())}
        />
        <Input
          aria-label="Name"
          placeholder="Screen specification"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="sm:col-span-3"
        />
        <Select value={level} onValueChange={(v) => setLevel(v as Level)} disabled={locked}>
          <SelectTrigger aria-label="Level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="project">Per project</SelectItem>
            <SelectItem value="item">Per item</SelectItem>
            <SelectItem value="release">Per release</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={kind}
          onValueChange={(v) => setKind(v as 'narrative' | 'form')}
          disabled={locked || !!detail}
        >
          <SelectTrigger aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="narrative">Sections</SelectItem>
            <SelectItem value="form">Form</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {locked && (
        <p className="text-muted-foreground text-sm">
          Built-in templates can be renamed and given a Word base, but their sections are fixed.
          Create your own template to change them.
        </p>
      )}
      {kind === 'narrative' ? (
        <div className="grid gap-2">
          {sections.map((s, i) => (
            <div
              key={i}
              className="grid gap-1 rounded-md border p-2"
              style={{ marginLeft: (s.level - 1) * 16 }}
            >
              <div className="flex items-center gap-2">
                <Select
                  value={String(s.level)}
                  onValueChange={(v) => set(i, { level: Number(v) as 1 | 2 | 3 })}
                  disabled={locked}
                >
                  <SelectTrigger size="sm" className="w-20" aria-label={`Section ${i + 1} level`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">H1</SelectItem>
                    <SelectItem value="2">H2</SelectItem>
                    <SelectItem value="3">H3</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={s.title}
                  disabled={locked}
                  onChange={(e) => set(i, { title: e.target.value })}
                  aria-label={`Section ${i + 1} title`}
                  className="h-8"
                />
                <Select
                  value={
                    s.repeat
                      ? s.repeat.source === 'items'
                        ? `items:${s.repeat.depth}`
                        : `release:${s.repeat.kind ?? 'all'}`
                      : 'none'
                  }
                  disabled={locked}
                  onValueChange={(v) =>
                    set(i, {
                      repeat:
                        v === 'none'
                          ? undefined
                          : v.startsWith('items:')
                            ? { source: 'items', depth: Number(v.slice(6)) as 1 | 2 }
                            : {
                                source: 'release_items',
                                ...(v === 'release:all'
                                  ? {}
                                  : { kind: v.slice(8) as 'new' | 'change' }),
                              },
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-44" aria-label={`Section ${i + 1} repeat`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Once</SelectItem>
                    <SelectItem value="items:1">Per top-level item</SelectItem>
                    <SelectItem value="items:2">Per item (2 levels)</SelectItem>
                    <SelectItem value="release:all">Per release item</SelectItem>
                    <SelectItem value="release:new">Per new release item</SelectItem>
                    <SelectItem value="release:change">Per changed release item</SelectItem>
                  </SelectContent>
                </Select>
                {!locked && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={i === sections.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setSections((ss) => ss.filter((_, j) => j !== i))}
                      aria-label="Remove section"
                    >
                      <XIcon />
                    </Button>
                  </>
                )}
              </div>
              <Textarea
                rows={2}
                placeholder="Hint for the AI: what must this section contain?"
                value={s.hint}
                disabled={locked}
                onChange={(e) => set(i, { hint: e.target.value })}
                aria-label={`Section ${i + 1} hint`}
              />
            </div>
          ))}
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSections((ss) => [
                    ...ss,
                    { id: String(ss.length + 1), title: 'New section', level: 1, hint: '' },
                  ])
                }
              >
                <PlusIcon />
                Add section
              </Button>
              <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
                <FileUpIcon />
                Import sections from .docx
              </Button>
              <input
                ref={importRef}
                type="file"
                accept=".docx"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f)
                    void upload('/admin/templates/import-sections', 'POST', f)
                      .then((d) => setSections((d as { sections: Section[] }).sections))
                      .catch(onError)
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <label className="grid gap-1">
          <span className="text-sm font-medium">Fields and sections (JSON)</span>
          <span className="text-muted-foreground text-xs">
            Fields: id, label, hint, type (text, longtext, date, list, table), columns for tables.
          </span>
          <Textarea
            rows={14}
            className="font-mono text-xs"
            value={formJson}
            disabled={locked}
            onChange={(e) => setFormJson(e.target.value)}
          />
        </label>
      )}
      {detail && (
        <div className="grid gap-1 border-t pt-3">
          <span className="text-sm font-medium">Word base document</span>
          <span className="text-muted-foreground text-xs">
            Your company's .docx with its styles, header, footer, and cover. Use{' '}
            {'{{title}} {{project}} {{version}} {{date}} {{author}}'} and a paragraph containing
            only {'{{content}}'} where the body goes.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => baseRef.current?.click()}>
              <FileUpIcon />
              {detail.hasBaseDocx ? 'Replace' : 'Upload'} .docx
            </Button>
            {detail.hasBaseDocx && (
              <>
                <Button variant="ghost" size="sm" asChild>
                  <a href={`/api/v1/admin/templates/${detail.key}/base-docx`}>Download</a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void api(`/admin/templates/${detail.key}/base-docx`, { method: 'DELETE' }).then(
                      onDone,
                      onError,
                    )
                  }
                >
                  Remove
                </Button>
              </>
            )}
            <input
              ref={baseRef}
              type="file"
              accept=".docx"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f)
                  void upload(`/admin/templates/${detail.key}/base-docx`, 'PUT', f)
                    .then(() => (toast('Base document saved'), onDone()))
                    .catch(onError)
              }}
            />
          </div>
        </div>
      )}
      <DialogFooter>
        <Button onClick={() => void save()} disabled={!name.trim() || (!detail && !key)}>
          Save template
        </Button>
      </DialogFooter>
    </div>
  )
}
