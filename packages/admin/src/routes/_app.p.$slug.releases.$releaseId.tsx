import { createFileRoute } from '@tanstack/react-router'

import { ReleaseDetailPage } from '@/features/releases/ReleaseDetailPage'

export const Route = createFileRoute('/_app/p/$slug/releases/$releaseId')({
  component: function ReleaseRoute() {
    const { slug, releaseId } = Route.useParams()
    return <ReleaseDetailPage slug={slug} releaseId={releaseId} />
  },
})
