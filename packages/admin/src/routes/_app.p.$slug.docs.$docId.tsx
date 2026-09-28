import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { DocumentPage } from '@/features/docs/DocumentPage'

export const Route = createFileRoute('/_app/p/$slug/docs/$docId')({
  validateSearch: z.object({ v: z.number().int().min(1).optional().catch(undefined) }),
  component: function DocumentRoute() {
    const { slug, docId } = Route.useParams()
    const { v } = Route.useSearch()
    return <DocumentPage key={`${docId}-${v ?? 'latest'}`} slug={slug} docId={docId} version={v} />
  },
})
