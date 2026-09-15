import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/notes')({
  component: NotesLayout,
})

/**
 * Marco de las rutas de notas.
 *
 * Existe por un motivo que costó un rato encontrar: en TanStack Router, **una ruta
 * padre tiene que pintar `<Outlet />` o su hija no aparece nunca**. Sin esto,
 * `/notes/una-nota.md` coincidía con su ruta, montaba el componente… y en la
 * pantalla se seguía viendo el marcador de posición del padre. El árbol de rutas
 * estaba bien; lo que faltaba era el hueco donde pintar.
 *
 * El marcador de «no hay ninguna nota abierta» vive ahora en `notes.index.tsx`,
 * que es la ruta de `/notes` a secas.
 */
function NotesLayout() {
  return <Outlet />
}
