import type { ReactNode } from 'react'

import { useConfig } from '@/api/queries'
import { I18nProvider, resolveLocale } from '@/i18n'

/**
 * Conecta el idioma guardado con el traductor.
 *
 * Va por encima del `BootGate` a propósito: mientras el core arranca todavía no
 * hay configuración, y en ese hueco se usa el idioma del sistema. Así la pantalla
 * de arranque ya sale en el idioma correcto en vez de cambiar de idioma en cuanto
 * llega la respuesta.
 */
export function I18nGate({ children }: { children: ReactNode }) {
  const config = useConfig()
  return <I18nProvider locale={resolveLocale(config.data?.language)}>{children}</I18nProvider>
}
