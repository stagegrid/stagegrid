import { Link } from '@tanstack/react-router'
import { FileTextIcon } from 'lucide-react'

import { EmptyState, ErrorState } from '@/components/page-state'
import { ProjectTabs } from '@/components/project-tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useProject } from '@/features/settings/queries'
import { relativeTime } from '@/lib/format'

import { useDocuments } from './queries'

export function DocsPage({ slug }: { slug: string }) {
  const { data: project } = useProject(slug)
  const { data: docs, isLoading, error, refetch } = useDocuments(slug)
  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <h1 className="truncate text-base font-semibold">{project?.name ?? '…'}</h1>
        <ProjectTabs slug={slug} />
      </div>
      <div className="p-6">
        {isLoading && <Skeleton className="h-40" />}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {docs?.length === 0 && (
          <EmptyState
            title="No documents yet"
            body={
              'Ask your AI to write one — for example: "Write a BRD for this project" or "Draft release notes for v1.2". It uses your templates and the project\'s data.'
            }
            action={
              <Button
                variant="outline"
                onClick={() =>
                  document.querySelector<HTMLButtonElement>('[data-connect-ai]')?.click()
                }
              >
                Connect AI
              </Button>
            }
          />
        )}
        {docs && docs.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>For</TableHead>
                <TableHead className="text-right">Version</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link
                      to="/p/$slug/docs/$docId"
                      params={{ slug, docId: d.id }}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <FileTextIcon className="text-muted-foreground size-4" />
                      {d.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{d.template.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.release
                      ? `Release ${d.release.name}`
                      : d.item
                        ? `${d.item.path}${d.stage ? ` › ${d.stage.name}` : ''}`
                        : 'Project'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">v{d.version}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {relativeTime(d.updatedAt)} · {d.updatedBy}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
