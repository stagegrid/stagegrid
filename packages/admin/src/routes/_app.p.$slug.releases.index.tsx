import { createFileRoute } from '@tanstack/react-router'

import { ReleasesPage } from '@/features/releases/ReleasesPage'

export const Route = createFileRoute('/_app/p/$slug/releases/')({
  component: function ReleasesRoute() {
    const { slug } = Route.useParams()
    return <ReleasesPage slug={slug} />
  },
})
