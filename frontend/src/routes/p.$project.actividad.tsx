import { createFileRoute } from '@tanstack/react-router'

import { ProjectActivity } from '@/features/projects/ProjectActivity'

export const Route = createFileRoute('/p/$project/actividad')({
  component: ProjectActivityRoute,
})

function ProjectActivityRoute() {
  const { project } = Route.useParams()
  return <ProjectActivity slug={project} />
}
