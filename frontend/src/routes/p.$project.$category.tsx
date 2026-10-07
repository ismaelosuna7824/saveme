import { createFileRoute } from '@tanstack/react-router'

import { summariesQuery } from '@/api/queries'
import { holdForData, queryClient } from '@/app/queryClient'
import { CategoryPage } from '@/features/projects/CategoryPage'
import { categoryFilter } from '@/features/projects/summaryFilters'

export const Route = createFileRoute('/p/$project/$category')({
  loader: ({ params }) =>
    holdForData(
      queryClient.ensureQueryData(summariesQuery(categoryFilter(params.project, params.category))),
    ),
  component: CategoryRoute,
})

function CategoryRoute() {
  const { project, category } = Route.useParams()
  return <CategoryPage slug={project} category={category} />
}
