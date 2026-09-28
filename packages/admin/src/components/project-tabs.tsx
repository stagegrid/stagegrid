import { Link } from '@tanstack/react-router'

const TABS = [
  { to: '/p/$slug', label: 'Board', exact: true },
  { to: '/p/$slug/timeline', label: 'Timeline', exact: false },
  { to: '/p/$slug/releases', label: 'Releases', exact: false },
  { to: '/p/$slug/docs', label: 'Docs', exact: false },
] as const

/** Board | Timeline | Releases | Docs switcher shown in each project page's toolbar. */
export function ProjectTabs({ slug }: { slug: string }) {
  return (
    <nav aria-label="Project views" className="bg-muted flex rounded-md p-0.5 text-xs">
      {TABS.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          params={{ slug }}
          activeOptions={{ exact: t.exact, includeSearch: false }}
          className="text-muted-foreground rounded px-2.5 py-1 font-medium"
          activeProps={{ className: 'bg-background text-foreground shadow-sm' }}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
