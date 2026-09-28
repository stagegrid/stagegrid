import type { ProjectDto } from '@stagegrid/shared'
import { Link } from '@tanstack/react-router'

import { ProgressBar } from '@/components/progress-bar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function ProjectCard({ project }: { project: ProjectDto }) {
  const s = project.stats
  return (
    <Link
      to="/p/$slug"
      params={{ slug: project.slug }}
      className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
    >
      <Card className="hover:border-primary/50 h-full transition-colors">
        <CardHeader>
          <CardTitle className="flex items-baseline justify-between gap-2">
            <span className="truncate">{project.name}</span>
            <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
              {s.percent}%
            </span>
          </CardTitle>
          {project.description && (
            <p className="text-muted-foreground line-clamp-2 text-sm">{project.description}</p>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          <ProgressBar percent={s.percent} />
          <dl className="grid grid-cols-4 gap-2 text-center text-xs">
            {(
              [
                ['All', s.all],
                ['To do', s.open],
                ['Doing', s.doing],
                ['Done', s.done],
              ] as const
            ).map(([label, n]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-sm font-medium tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
          {s.stale > 0 && <p className="text-status-stale text-xs">{s.stale} need an update</p>}
        </CardContent>
      </Card>
    </Link>
  )
}
