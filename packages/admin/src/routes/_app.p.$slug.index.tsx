import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { BoardPage } from '@/features/board/BoardPage'

export const Route = createFileRoute('/_app/p/$slug/')({
  validateSearch: z.object({
    todo: z.boolean().optional().catch(undefined),
    stale: z.boolean().optional().catch(undefined),
    who: z.string().optional().catch(undefined),
  }),
  component: function BoardRoute() {
    const { slug } = Route.useParams()
    const search = Route.useSearch()
    const navigate = Route.useNavigate()
    return (
      <BoardPage
        slug={slug}
        search={search}
        setSearch={(s) => void navigate({ search: s, replace: true })}
      />
    )
  },
})
