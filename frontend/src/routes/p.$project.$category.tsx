import { createFileRoute } from '@tanstack/react-router'

import { CategoryPage } from '@/features/projects/CategoryPage'

export const Route = createFileRoute('/p/$project/$category')({
  component: CategoryRoute,
})

function CategoryRoute() {
  const { project, category } = Route.useParams()
  return <CategoryPage slug={project} category={category} />
}
