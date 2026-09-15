import { createFileRoute } from '@tanstack/react-router'

import { EditorPage } from '@/features/editor/EditorPage'

export const Route = createFileRoute('/s/$id')({
  component: EditorRoute,
})

function EditorRoute() {
  const { id } = Route.useParams()
  // `key` fuerza un editor nuevo por documento: sin él, al saltar de un resumen
  // a otro la ruta se reutiliza y el estado del documento anterior sobrevive.
  return <EditorPage key={id} id={id} />
}
