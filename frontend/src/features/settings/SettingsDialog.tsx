import { useState } from 'react'
import { FolderCog, Info, Palette, Plug } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'
import { SettingsAgents } from '@/features/settings/SettingsAgents'
import { SettingsApp } from '@/features/settings/SettingsApp'
import { SettingsAppearance } from '@/features/settings/SettingsAppearance'
import { SettingsWorkspace } from '@/features/settings/SettingsWorkspace'
import { useT, type TranslationKey } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Las claves de sección son identificadores internos y no se traducen: son las que
 * deciden qué panel se monta. Lo que se traduce son sus etiquetas.
 */
const SECTIONS = [
  {
    key: 'apariencia',
    label: 'settings.nav.appearance',
    hint: 'settings.navHint.appearance',
    icon: Palette,
  },
  { key: 'agentes', label: 'settings.nav.agents', hint: 'settings.navHint.agents', icon: Plug },
  // La sección de la app va la última: se entra a cambiar el aspecto o a
  // configurar agentes, no a mirar la versión. Está para poder comprobar a mano
  // que las actualizaciones funcionan, que es lo que el aviso automático no deja
  // ver cuando no hay ninguna.
  { key: 'app', label: 'settings.nav.app', hint: 'settings.navHint.app', icon: Info },
  {
    key: 'workspace',
    label: 'settings.nav.workspace',
    hint: 'settings.navHint.workspace',
    icon: FolderCog,
  },
] as const satisfies readonly {
  key: string
  label: TranslationKey
  hint: TranslationKey
  icon: typeof Palette
}[]

type SectionKey = (typeof SECTIONS)[number]['key']

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Diálogo de ajustes.
 *
 * Es un modal grande con navegación lateral, en la misma línea que el asistente
 * de bienvenida: no es una ruta, así que se puede abrir desde cualquier pantalla
 * sin que el router se entere. Cada sección persiste con `PUT /config` en el
 * momento en que se toca, así que no hay botón de guardar que se pueda olvidar.
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const t = useT()
  const [section, setSection] = useState<SectionKey>('apariencia')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] flex-col sm:max-w-4xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 pr-8">
          <DialogTitle className="shrink-0 text-2xs uppercase tracking-[0.14em] text-primary">
            {t('settings.title')}
          </DialogTitle>
          <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
            {t('settings.footer')}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav
            aria-label={t('settings.sectionsLabel')}
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-48 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r"
          >
            {SECTIONS.map((item) => {
              const Icon = item.icon
              const active = section === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setSection(item.key)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 border px-2 py-1.5 text-left transition-colors motion-reduce:transition-none',
                    active
                      ? 'border-primary/45 bg-primary/5 text-primary'
                      : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs">{t(item.label)}</span>
                    <span className="hidden truncate text-2xs text-muted-foreground sm:block">
                      {t(item.hint)}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <DialogDescription className="sr-only">
              {t('settings.subtitle')}
            </DialogDescription>
            {section === 'apariencia' ? <SettingsAppearance /> : null}
            {section === 'agentes' ? <SettingsAgents /> : null}
            {section === 'workspace' ? <SettingsWorkspace /> : null}
            {section === 'app' ? <SettingsApp /> : null}
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <span className="mr-auto text-2xs text-muted-foreground">
            {t('settings.footerNote')}
          </span>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
