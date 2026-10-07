import { createFileRoute } from '@tanstack/react-router'

import { summariesQuery } from '@/api/queries'
import { holdForData, queryClient } from '@/app/queryClient'
import { ProjectOverview } from '@/features/projects/ProjectOverview'
import { projectOverviewFilter } from '@/features/projects/summaryFilters'

export const Route = createFileRoute('/p/$project/')({
  loader: ({ params }) =>
    holdForData(queryClient.ensureQueryData(summariesQuery(projectOverviewFilter(params.project)))),
  component: ProjectOverviewRoute,
})

function ProjectOverviewRoute() {
  const { project } = Route.useParams()
  return <ProjectOverview slug={project} />
}
