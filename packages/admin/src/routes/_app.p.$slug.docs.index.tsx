import { createFileRoute } from '@tanstack/react-router'

import { DocsPage } from '@/features/docs/DocsPage'

export const Route = createFileRoute('/_app/p/$slug/docs/')({
  component: function DocsRoute() {
    const { slug } = Route.useParams()
    return <DocsPage slug={slug} />
  },
})
