import { Link } from '@tanstack/react-router'
import {
  DownloadIcon,
  MaximizeIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlusIcon,
  SettingsIcon,
  WifiOffIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ErrorState } from '@/components/page-state'
import { ProjectTabs } from '@/components/project-tabs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { AddItemsDialog } from './AddItemsDialog'
import { BoardGrid, Legend } from './BoardGrid'
import { useBoard } from './queries'
import { SummaryPanel } from './SummaryPanel'
import { useLocalBoolean, useLocalSet } from './useLocalSet'
import { useProjectStream } from './useProjectStream'
import { assigneeKey, visibleRows } from './visible-rows'

const ALL = '__all__'

export interface BoardSearch {
  todo?: boolean
  stale?: boolean
  /** assignee key, see `assigneeKey` */
  who?: string
}

export function BoardPage({
  slug,
  search,
  setSearch,
}: {
  slug: string
  search: BoardSearch
  setSearch: (s: BoardSearch) => void
}) {
  const { data: board, error, isLoading, refetch } = useBoard(slug)
  const { connected } = useProjectStream(slug)
  const [collapsed, toggleCollapsed] = useLocalSet(`stagegrid:collapsed:${slug}`)
  const [showSummary, setShowSummary] = useLocalBoolean(
    'stagegrid:summary',
    window.matchMedia('(min-width: 768px)').matches,
  )
  const [present, setPresent] = useState(false)
  const [adding, setAdding] = useState<{ parent: { id: string; name: string } | null } | null>(null)
  const filters = useMemo(
    () => ({ allToDo: !!search.todo, needsUpdate: !!search.stale, assignee: search.who }),
    [search.todo, search.stale, search.who],
  )
  const people = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const i of board?.items ?? [])
      for (const a of i.assignees) byKey.set(assigneeKey(a), a.name)
    return [...byKey].sort((a, b) => a[1].localeCompare(b[1]))
  }, [board])
  const rows = useMemo(
    () => (board ? visibleRows(board, collapsed, filters) : []),
    [board, collapsed, filters],
  )

  useEffect(() => {
    if (!present) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPresent(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [present])

  if (isLoading) return <Skeleton className="m-6 h-96" />
  if (error || !board) return <ErrorState error={error} onRetry={() => void refetch()} />
  const canEdit = board.project.role !== 'viewer'

  return (
    <div
      className={cn(
        'flex h-[calc(100svh-3.5rem)] flex-col',
        present && 'bg-background fixed inset-0 z-50 h-svh text-[125%]',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setShowSummary(!showSummary)}
          aria-label={showSummary ? 'Hide summary' : 'Show summary'}
        >
          {showSummary ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
        </Button>
        <h1 className="truncate text-base font-semibold">{board.project.name}</h1>
        <span className="text-muted-foreground text-xs">Items: {board.stats.items}</span>
        {!present && <ProjectTabs slug={slug} />}
        {!connected && (
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            <WifiOffIcon className="size-3.5" />
            Reconnecting…
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {people.length > 0 && (
            <Select
              value={search.who ?? ALL}
              onValueChange={(v) => setSearch({ ...search, who: v === ALL ? undefined : v })}
            >
              <SelectTrigger size="sm" className="h-7 w-40 text-xs" aria-label="Filter by assignee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Everyone</SelectItem>
                {people.map(([key, name]) => (
                  <SelectItem key={key} value={key}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Label className="flex items-center gap-1.5 text-xs font-normal">
            <Checkbox
              checked={filters.allToDo}
              onCheckedChange={(v) => setSearch({ ...search, todo: v === true || undefined })}
            />
            All to do
          </Label>
          <Label className="flex items-center gap-1.5 text-xs font-normal">
            <Checkbox
              checked={filters.needsUpdate}
              onCheckedChange={(v) => setSearch({ ...search, stale: v === true || undefined })}
            />
            Needs update
          </Label>
          {present ? (
            <Button variant="outline" size="sm" onClick={() => setPresent(false)}>
              <XIcon />
              Exit
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setPresent(true)}>
                <MaximizeIcon />
                Present
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <DownloadIcon />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={`/api/v1/projects/${slug}/export?format=json`}>JSON</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`/api/v1/projects/${slug}/export?format=csv`}>CSV (Excel)</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon-sm" asChild aria-label="Project settings">
                <Link to="/p/$slug/settings" params={{ slug }}>
                  <SettingsIcon />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {(showSummary || present) && (
          <SummaryPanel
            board={board}
            className="w-72 shrink-0 overflow-y-auto"
            onNeedsUpdate={() => setSearch({ ...search, stale: true })}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {board.items.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <h2 className="font-semibold">Add your first items</h2>
              <p className="text-muted-foreground max-w-sm text-sm">
                Items are your menus and features. Each gets a cell per stage.
              </p>
              {canEdit && (
                <Button className="mt-2" onClick={() => setAdding({ parent: null })}>
                  <PlusIcon />
                  Add items
                </Button>
              )}
            </div>
          ) : (
            <BoardGrid
              board={board}
              rows={rows}
              onToggle={toggleCollapsed}
              onAddChild={(parent) => setAdding({ parent })}
              className="flex-1"
            />
          )}
          <div className="flex items-center gap-4 border-t px-4 py-2">
            {canEdit && board.items.length > 0 && !present && (
              <Button variant="ghost" size="sm" onClick={() => setAdding({ parent: null })}>
                <PlusIcon />
                Add item
              </Button>
            )}
            <Legend />
          </div>
        </div>
      </div>
      <AddItemsDialog
        slug={slug}
        parent={adding?.parent ?? null}
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
      />
    </div>
  )
}
