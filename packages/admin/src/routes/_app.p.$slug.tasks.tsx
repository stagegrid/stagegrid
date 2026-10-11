import { createFileRoute } from '@tanstack/react-router'

import { TasksPage } from '@/features/tasks/TasksPage'

export const Route = createFileRoute('/_app/p/$slug/tasks')({
  component: function TasksRoute() {
    const { slug } = Route.useParams()
    return <TasksPage slug={slug} />
  },
})
