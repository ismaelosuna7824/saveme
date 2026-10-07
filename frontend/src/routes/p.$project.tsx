import { createFileRoute } from '@tanstack/react-router'

import { categoriesQuery, projectsQuery } from '@/api/queries'
import { holdForData, queryClient } from '@/app/queryClient'
import { ProjectLayout } from '@/features/projects/ProjectLayout'

export const Route = createFileRoute('/p/$project')({
  // La cabecera y las pestañas salen de estas dos listas: con ellas en caché, el
  // marco del proyecto aparece entero en vez de pasar por el esqueleto.
  loader: () =>
    holdForData(
      queryClient.ensureQueryData(projectsQuery()),
      queryClient.ensureQueryData(categoriesQuery()),
    ),
  component: ProjectRoute,
})

function ProjectRoute() {
  const { project } = Route.useParams()
  return <ProjectLayout slug={project} />
}
