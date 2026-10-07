import { createFileRoute } from '@tanstack/react-router'

import { summaryQuery } from '@/api/queries'
import { holdForData, queryClient } from '@/app/queryClient'
import { EditorPage } from '@/features/editor/EditorPage'

export const Route = createFileRoute('/s/$id')({
  // `fetchQuery` y no `ensureQueryData`: el editor abre con lo que hay en disco,
  // no con una copia vieja de la caché que se reemplazaría nada más abrir.
  loader: ({ params }) => holdForData(queryClient.fetchQuery(summaryQuery(params.id))),
  component: EditorRoute,
})

function EditorRoute() {
  const { id } = Route.useParams()
  // `key` fuerza un editor nuevo por documento: sin él, al saltar de un resumen
  // a otro la ruta se reutiliza y el estado del documento anterior sobrevive.
  return <EditorPage key={id} id={id} />
}
