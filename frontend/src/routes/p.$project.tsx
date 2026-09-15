import { createFileRoute } from '@tanstack/react-router'

import { ProjectLayout } from '@/features/projects/ProjectLayout'

export const Route = createFileRoute('/p/$project')({
  component: ProjectRoute,
})

function ProjectRoute() {
  const { project } = Route.useParams()
  return <ProjectLayout slug={project} />
}
