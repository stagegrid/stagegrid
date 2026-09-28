import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { ErrorState, PageHeader } from '@/components/page-state'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { GeneralSection } from '@/features/settings/GeneralSection'
import { MembersSection } from '@/features/settings/MembersSection'
import { useProject } from '@/features/settings/queries'
import { StagesSection } from '@/features/settings/StagesSection'

export const Route = createFileRoute('/_app/p/$slug/settings')({
  component: function SettingsRoute() {
    const { slug } = Route.useParams()
    const { data: project, error, isLoading, refetch } = useProject(slug)
    if (isLoading) return <Skeleton className="m-6 h-96" />
    if (error || !project) return <ErrorState error={error} onRetry={() => void refetch()} />
    const readOnly = project.role !== 'owner'
    return (
      <div>
        <PageHeader
          title={`${project.name} settings`}
          description={readOnly ? 'Only owners can change these settings.' : undefined}
          actions={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/p/$slug" params={{ slug: project.slug }}>
                <ArrowLeftIcon />
                Back to board
              </Link>
            </Button>
          }
        />
        <div className="grid gap-10 p-6">
          <GeneralSection project={project} readOnly={readOnly} />
          <StagesSection slug={project.slug} readOnly={readOnly} />
          <MembersSection slug={project.slug} readOnly={readOnly} />
          <section className="grid gap-2">
            <h2 className="text-base font-semibold">Export</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/v1/projects/${project.slug}/export?format=json`}>Download JSON</a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/v1/projects/${project.slug}/export?format=csv`}>Download CSV</a>
              </Button>
            </div>
          </section>
        </div>
      </div>
    )
  },
})
