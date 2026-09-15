import { createFileRoute } from '@tanstack/react-router'

import { TagPage } from '@/features/projects/TagPage'

export const Route = createFileRoute('/t/$tag')({
  component: TagRoute,
})

function TagRoute() {
  const { tag } = Route.useParams()
  return <TagPage tag={tag} />
}
