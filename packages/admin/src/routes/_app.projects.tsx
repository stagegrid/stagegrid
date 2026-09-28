import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { EmptyState, ErrorState, PageHeader } from '@/components/page-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useMe } from '@/features/auth/queries'
import { CreateProjectDialog } from '@/features/projects/CreateProjectDialog'
import { ProjectCard } from '@/features/projects/ProjectCard'
import { useProjects } from '@/features/projects/queries'

export const Route = createFileRoute('/_app/projects')({
  validateSearch: z.object({ archived: z.boolean().catch(false).optional() }),
  component: ProjectsPage,
})

function ProjectsPage() {
  const { archived = false } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data: me } = useMe()
  const { data, isLoading, error, refetch } = useProjects(archived)

  return (
    <div>
      <PageHeader
        title="Projects"
        actions={
          <>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={archived ? 'archived' : 'active'}
              onValueChange={(v) => v && void navigate({ search: { archived: v === 'archived' } })}
            >
              <ToggleGroupItem value="active">Active</ToggleGroupItem>
              <ToggleGroupItem value="archived">Archived</ToggleGroupItem>
            </ToggleGroup>
            {me?.isAdmin && <CreateProjectDialog />}
          </>
        }
      />
      <div className="p-6">
        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data?.length === 0 &&
          (archived ? (
            <EmptyState title="No archived projects" />
          ) : me?.isAdmin ? (
            <EmptyState
              title="Create your first project"
              body="A project is a grid of items (menus, features) × stages."
              action={<CreateProjectDialog />}
            />
          ) : (
            <EmptyState
              title="You're not on any projects yet"
              body="Ask an admin or project owner to add you."
            />
          ))}
        {data && data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
