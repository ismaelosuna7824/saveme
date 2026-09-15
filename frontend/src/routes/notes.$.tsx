import { createFileRoute } from '@tanstack/react-router'

import { NoteEditor } from '@/features/notes/NoteEditor'

export const Route = createFileRoute('/notes/$')({
  component: NoteRoute,
})

function NoteRoute() {
  // El splat llega entero, con sus barras: así una nota puede estar anidada
  // tantos niveles como haga falta sin tener que codificar la ruta.
  const { _splat } = Route.useParams()
  return <NoteEditor path={_splat ?? ''} />
}
