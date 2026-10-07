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
  // `key`: la ruta se reutiliza al cambiar de proyecto, y sin él la búsqueda
  // escrita en uno seguía puesta en el siguiente.
  return <ProjectOverview key={project} slug={project} />
}
