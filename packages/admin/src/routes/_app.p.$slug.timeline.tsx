import { createFileRoute } from '@tanstack/react-router'

import { TimelinePage } from '@/features/timeline/TimelinePage'

export const Route = createFileRoute('/_app/p/$slug/timeline')({
  component: function TimelineRoute() {
    const { slug } = Route.useParams()
    return <TimelinePage slug={slug} />
  },
})
