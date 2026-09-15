import { createFileRoute } from '@tanstack/react-router'

import { ProjectOverview } from '@/features/projects/ProjectOverview'

export const Route = createFileRoute('/p/$project/')({
  component: ProjectOverviewRoute,
})

function ProjectOverviewRoute() {
  const { project } = Route.useParams()
  return <ProjectOverview slug={project} />
}
