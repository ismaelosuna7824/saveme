import { Palette } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useConfig, useUpdateConfig } from '@/api/queries'
import { Button } from '@/components/ui/button'
import { nextTheme, resolveTheme, themeOption } from '@/features/settings/themeOptions'
import { useT } from '@/i18n'

/**
 * Pasa al tema siguiente del ciclo.
 *
 * Antes era un interruptor de dos estados (`phosphor` / `plain`) que en realidad
 * encendía y apagaba las scanlines. Con siete temas eso ya no se sostiene: el
 * botón avanza por la lista y el título dice a cuál va, que es la información
 * útil cuando hay más de dos. Elegir uno concreto se hace en Ajustes.
 *
 * Se persiste con `PUT /config`, así que sobrevive al reinicio.
 */
export function ThemeToggle() {
  const t = useT()
  const config = useConfig()
  const update = useUpdateConfig()

  const current = resolveTheme(config.data?.theme)
  const upcoming = nextTheme(current)
  const upcomingName = themeOption(upcoming)?.nameKey

  const toggle = () => {
    update.mutate(
      { theme: upcoming },
      {
        onSuccess: () => {
          toast.success(
            upcomingName ? t('shell.theme.changed', { name: t(upcomingName) }) : upcoming,
          )
        },
        onError: (error) => {
          toast.error(t('shell.theme.failed'), { description: errorMessage(error) })
        },
      },
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      disabled={update.isPending}
      title={
        upcomingName ? t('shell.theme.next', { name: t(upcomingName) }) : t('shell.theme.toggle')
      }
      aria-label={t('shell.theme.toggle')}
    >
      <Palette className="size-3 text-primary" />
    </Button>
  )
}
