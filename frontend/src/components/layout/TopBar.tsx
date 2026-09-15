import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'
import { Command as CommandIcon, Settings as SettingsIcon } from 'lucide-react'

import { IS_MACOS } from '@/api/client'
import type { ServerEventsState } from '@/api/events'
import { useStats } from '@/api/queries'
import { StatusDot, type StatusTone } from '@/components/common/StatusDot'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { useBreadcrumbs } from '@/components/layout/useBreadcrumbs'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ReindexButton } from '@/features/dashboard/ReindexButton'
import { useUi } from '@/app/preferences'
import { useT, type Translate } from '@/i18n'
import { cn } from '@/lib/utils'

function connectionTone(events: ServerEventsState): StatusTone {
  if (events.connected) return 'ok'
  return events.lastEventAt === null ? 'warn' : 'error'
}

function connectionLabel(events: ServerEventsState, t: Translate): string {
  if (events.connected) {
    return events.lastEventType
      ? t('shell.topBar.eventsConnectedLast', { type: events.lastEventType })
      : t('shell.topBar.eventsConnected')
  }
  return t('shell.topBar.eventsDisconnected')
}

/**
 * Barra superior: prompt de shell + estado del core + acciones globales.
 *
 * En macOS **es además la barra de título de la ventana**: la nativa está
 * oculta, así que aquí van dos cosas que no se ven pero hacen falta.
 *
 *  - `data-tauri-drag-region`: arrastra la ventana. Solo afecta al propio
 *    `<header>`, no a sus hijos, así que los enlaces y botones siguen siendo
 *    pulsables. El doble clic hace zoom, que es lo que espera cualquiera en
 *    macOS.
 *  - `pl-[78px]`: el hueco de los semáforos. Sin él, el `❯` quedaría debajo del
 *    botón de cerrar.
 */
export function TopBar({ events }: { events: ServerEventsState }) {
  const t = useT()
  const crumbs = useBreadcrumbs()
  const stats = useStats()
  const { openPalette, setSettingsOpen } = useUi()

  return (
    <header
      data-tauri-drag-region
      className={cn(
        'flex h-9 shrink-0 items-center gap-3 border-b border-border bg-panel',
        IS_MACOS ? 'pl-[78px] pr-3' : 'px-3',
      )}
    >
      <nav className="flex min-w-0 items-baseline gap-1 text-xs" aria-label={t('shell.topBar.breadcrumbs')}>
        <span className="prompt-caret">❯</span>
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 ? <span className="text-border-strong">/</span> : null}
            {crumb.href ? (
              <Link
                to={crumb.href}
                className="truncate text-muted-foreground transition-colors hover:text-primary"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate text-primary">{crumb.label}</span>
            )}
          </Fragment>
        ))}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden text-2xs text-muted-foreground lg:inline">
          {stats.data
            ? t('shell.topBar.stats', {
                projects: stats.data.projects,
                summaries: stats.data.summaries,
                pending: stats.data.pending_proposals,
              })
            : t('shell.topBar.loadingStats')}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <StatusDot tone={connectionTone(events)} />
              <span className="hidden xl:inline">{t('shell.topBar.events')}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{connectionLabel(events, t)}</TooltipContent>
        </Tooltip>

        <ReindexButton withLabel={false} />
        <ThemeToggle />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSettingsOpen(true)}
              aria-label={t('shell.topBar.settings')}
            >
              <SettingsIcon className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('shell.topBar.settingsHint')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={openPalette}>
              <CommandIcon className="size-3" />K
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('shell.topBar.paletteHint')}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
