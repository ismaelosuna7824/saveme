import { createFileRoute } from '@tanstack/react-router'

import { projectTimelineQuery } from '@/api/queries'
import { holdForData, queryClient } from '@/app/queryClient'
import { ProjectTimelineView } from '@/features/projects/ProjectTimelineView'

export const Route = createFileRoute('/p/$project/historia')({
  loader: ({ params }) => holdForData(queryClient.ensureQueryData(projectTimelineQuery(params.project))),
  component: ProjectTimelineRoute,
})

function ProjectTimelineRoute() {
  const { project } = Route.useParams()
  return <ProjectTimelineView slug={project} />
}
