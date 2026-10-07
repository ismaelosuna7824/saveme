import { createFileRoute } from '@tanstack/react-router'

import { projectGraphQuery } from '@/api/queries'
import { holdForData, queryClient } from '@/app/queryClient'
import { DecisionMap } from '@/features/projects/DecisionMap'

export const Route = createFileRoute('/p/$project/mapa')({
  loader: ({ params }) => holdForData(queryClient.ensureQueryData(projectGraphQuery(params.project))),
  component: DecisionMapRoute,
})

function DecisionMapRoute() {
  const { project } = Route.useParams()
  return <DecisionMap slug={project} />
}
