import { useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, TriangleAlert } from 'lucide-react'

import { errorMessage } from '@/api/client'
import type { ConfigPatch } from '@/api/types'
import { useConfig, useReindex, useUpdateConfig } from '@/api/queries'
import type { ReindexResult } from '@/api/types'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatsPanel } from '@/features/dashboard/StatsPanel'
import { CopyField } from '@/features/onboarding/CopyField'
import { TrashPanel } from '@/features/settings/TrashPanel'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** Resultado real de una reindexación. Nada se pinta si el core no lo mandó. */
function ReindexSummary({ result }: { result: ReindexResult }) {
  const t = useT()
  const metrics = [
    { label: t('settings.workspace.added'), value: result.added },
    { label: t('settings.workspace.updated'), value: result.updated },
    { label: t('settings.workspace.removed'), value: result.removed },
    { label: t('settings.workspace.unchanged'), value: result.unchanged },
  ]
  const errors = result.errors ?? []

  return (
    <div className="space-y-1 border border-secondary/35 bg-secondary/5 px-2 py-1.5">
      <p className="text-2xs text-secondary">
        {result.indexed} archivos leídos · {result.projects_discovered} proyectos ·{' '}
        {result.duration_ms} ms
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {metrics.map((metric) => (
          <span key={metric.label} className="text-2xs text-muted-foreground">
            {metric.label}: <span className="text-foreground">{metric.value}</span>
          </span>
        ))}
      </div>
      {errors.length > 0 ? (
        <div className="space-y-0.5">
          {errors.map((message) => (
            <p key={message} className="text-2xs text-destructive">
              {message}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Sección «Workspace»: dónde vive el contenido y cómo se reindexa.
 *
 * El markdown en disco es la fuente de verdad; el índice SQLite es derivado y se
 * puede reconstruir sin perder nada. Reindexar informa lo que pasó de verdad,
 * incluidos los archivos que no cambió.
 */
export function SettingsWorkspace() {
  const t = useT()
  const config = useConfig()
  const reindex = useReindex()
  const update = useUpdateConfig()
  const [result, setResult] = useState<ReindexResult | null>(null)

  const busy = update.isPending
  const [candidate, setCandidate] = useState('')

  // Cambiar la raíz no se aplica en caliente: el workspace y SQLite se abren una
  // sola vez al arrancar, así que queda pendiente hasta reiniciar. La interfaz lo
  // dice en vez de fingir que ya está.
  const apply = (patch: ConfigPatch, ok: string) => {
    update.mutate(patch, {
      onSuccess: () => toast.success(ok),
      onError: (error) =>
        toast.error(t('settings.workspace.configFailed'), { description: errorMessage(error) }),
    })
  }

  const run = () => {
    reindex.mutate(undefined, {
      onSuccess: (next) => {
        setResult(next)
        toast.success(`Índice reconstruido: ${next.indexed} archivos`, {
          description: `+${next.added} · ~${next.updated} · -${next.removed} · =${next.unchanged}`,
        })
      },
      onError: (error) => {
        toast.error(t('settings.workspace.reindexFailedToast'), { description: errorMessage(error) })
      },
    })
  }

  if (config.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (config.error) {
    return (
      <ErrorPanel
        error={config.error}
        title={t('settings.workspace.configFailed')}
        onRetry={() => {
          void config.refetch()
        }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionHeader title={t('settings.workspace.location')} hint="GET /config" />
        <div className="space-y-2 border border-border bg-panel px-2 py-2">
          <div className="space-y-0.5">
            <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">raíz</div>
            <code className="block break-all text-2xs text-muted-foreground">
              {config.data?.root_dir ?? ''}
            </code>
          </div>
          <div className="space-y-0.5">
            <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
              configuración
            </div>
            <code className="block break-all text-2xs text-muted-foreground">
              {config.data?.config_path ?? ''}
            </code>
          </div>
        </div>

        {config.data?.root_state === 'created' ? (
          <div className="space-y-1.5 border border-destructive/40 bg-destructive/10 px-2 py-2">
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              <span>{t('settings.workspace.rootCreated')}</span>
            </p>

            {/* Escribir la ruta hace falta de verdad: si el usuario movió la
                carpeta, ninguna lista de recientes puede saber a dónde fue. */}
            <div className="flex items-center gap-2">
              <Input
                value={candidate}
                onChange={(event) => setCandidate(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && candidate.trim() !== '') {
                    apply({ root_dir: candidate.trim() }, t('settings.workspace.rootSwitched'))
                  }
                }}
                placeholder={t('settings.workspace.rootPlaceholder')}
                aria-label={t('settings.workspace.rootPlaceholder')}
                className="h-7 min-w-0 flex-1 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={busy || candidate.trim() === ''}
                onClick={() =>
                  apply({ root_dir: candidate.trim() }, t('settings.workspace.rootSwitched'))
                }
              >
                {t('settings.workspace.rootUse')}
              </Button>
            </div>
            {config.data.root_suggestions.length > 0 ? (
              <>
                <p className="text-2xs text-muted-foreground">
                  {t('settings.workspace.rootSuggestions')}
                </p>
                <ul className="space-y-1">
                  {config.data.root_suggestions.map((candidate) => (
                    <li key={candidate} className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate text-2xs" title={candidate}>
                        {candidate}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          apply(
                            { root_dir: candidate },
                            t('settings.workspace.rootSwitched'),
                          )
                        }
                      >
                        {t('settings.workspace.rootUse')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        {config.data?.root_change_pending ? (
          <div className="flex items-start gap-2 border border-primary/35 bg-primary/5 px-2 py-2">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <p className="text-2xs text-foreground">
              Hay una carpeta raíz nueva guardada que todavía no se aplicó. El workspace y la base
              de datos se abren una sola vez al arrancar, así que <span className="text-primary">
              cierra y vuelve a abrir SaveMe</span> para que el cambio valga.
            </p>
          </div>
        ) : null}

        {config.data?.root_from_env ? (
          <p className="text-2xs text-muted-foreground">
            La raíz la fija <code>SAVEME_ROOT</code> en el entorno y gana sobre el archivo de
            configuración.
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <StatsPanel />

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={run} disabled={reindex.isPending}>
              <RefreshCw
                className={cn(
                  'size-3',
                  reindex.isPending && 'animate-spin motion-reduce:animate-none',
                )}
              />
              {reindex.isPending
                ? t('settings.workspace.reindexing')
                : t('settings.workspace.reindexFromDisk')}
            </Button>
            <span className="text-2xs text-muted-foreground">
              Reconciliar el índice con los archivos que hay ahora.
            </span>
          </div>

          {result ? <ReindexSummary result={result} /> : null}

          {reindex.error ? (
            <ErrorPanel error={reindex.error} title={t('settings.workspace.reindexFailed')} onRetry={run} />
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeader title={t('settings.workspace.doctor.title')} />
        <p className="text-2xs text-muted-foreground">
          El workspace son archivos markdown normales en disco: ábrelos, muévelos o versiónalos con
          git sin pasar por la app. El índice solo acelera las búsquedas y se puede reconstruir sin
          perder contenido.
        </p>
        <p className="text-2xs text-muted-foreground">
          Si algo no cuadra, este comando diagnostica sin tocar nada:
        </p>
        <CopyField
          label={t('settings.workspace.doctorLabel')}
          value="saveme doctor"
          maxLines={2}
          hint={t('settings.workspace.doctorHint')}
        />
      </section>

      <TrashPanel />
    </div>
  )
}
