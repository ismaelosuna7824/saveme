import { createFileRoute } from '@tanstack/react-router'

import { activityQuery, briefingQuery } from '@/api/queries'
import { holdForData, queryClient } from '@/app/queryClient'
import { DEFAULT_ACTIVITY_DAYS, ProjectActivity } from '@/features/projects/ProjectActivity'

export const Route = createFileRoute('/p/$project/actividad')({
  loader: ({ params }) =>
    holdForData(
      queryClient.ensureQueryData(briefingQuery(params.project, DEFAULT_ACTIVITY_DAYS)),
      queryClient.ensureQueryData(activityQuery(params.project, DEFAULT_ACTIVITY_DAYS)),
    ),
  component: ProjectActivityRoute,
})

function ProjectActivityRoute() {
  const { project } = Route.useParams()
  return <ProjectActivity slug={project} />
}
