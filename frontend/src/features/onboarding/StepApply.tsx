import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  RefreshCw,
  Terminal,
  TriangleAlert,
} from 'lucide-react'

import { useConfigureMCP, useMCPSnippet } from '@/api/queries'
import type { MCPConfigureAction, MCPConfigureResult, MCPProvider } from '@/api/types'
import { asArray, asStringArray } from '@/api/normalize'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/features/onboarding/CopyField'
import { useT, type TranslationKey } from '@/i18n'

interface StepApplyProps {
  providers: MCPProvider[]
  selected: string[]
  /**
   * El asistente aplica solo al entrar en el paso. Ajustes reutiliza este mismo
   * panel para reconfigurar a demanda, así que ahí se pasa `false`.
   */
  autoRun?: boolean
  /**
   * Ajustes pinta su propio botón de configurar y necesita la acción y el
   * estado. Se recibe como render prop para que el disparo y los resultados
   * sigan viviendo en el mismo sitio.
   */
  renderActions?: (actions: { run: () => void; pending: boolean; done: boolean }) => ReactNode
}

type Tone = 'ok' | 'neutral' | 'warn' | 'bad'

/**
 * El núcleo manda la acción como cadena; aquí se traduce a un tono y a una clave.
 *
 * Los textos viven en la traducción, no en el módulo: `useT()` es un hook y no se
 * puede llamar fuera de un componente, así que el mapa guarda claves y la
 * resolución ocurre dentro de `ResultRow`.
 */
const ACTION_TONE: Record<string, Tone> = {
  created: 'ok',
  merged: 'ok',
  updated: 'ok',
  'already-configured': 'neutral',
  manual: 'warn',
  unknown: 'warn',
  error: 'bad',
}

const ACTION_KEY: Record<string, TranslationKey> = {
  created: 'onboarding.apply.action.created',
  merged: 'onboarding.apply.action.merged',
  updated: 'onboarding.apply.action.updated',
  'already-configured': 'onboarding.apply.action.alreadyConfigured',
  manual: 'onboarding.apply.action.manual',
  unknown: 'common.state.unknown',
  error: 'common.state.error',
}

function actionIcon(action: MCPConfigureAction): ReactNode {
  switch (action) {
    case 'created':
    case 'merged':
    case 'updated':
      return <CircleCheck className="size-3.5 text-secondary" />
    case 'already-configured':
      return <Info className="size-3.5 text-info" />
    case 'manual':
      return <Terminal className="size-3.5 text-primary" />
    case 'unknown':
      return <CircleAlert className="size-3.5 text-primary" />
    case 'error':
      return <TriangleAlert className="size-3.5 text-destructive" />
  }
}

/** Bloque manual de un cliente: primero el comando, y si no lo hay, el snippet. */
export function ManualSnippet({ providerKey }: { providerKey: string }) {
  const t = useT()
  const snippet = useMCPSnippet(providerKey)

  if (snippet.isLoading) {
    return <p className="text-2xs text-muted-foreground">{t('onboarding.apply.snippetLoading')}</p>
  }
  if (snippet.error) {
    return (
      <ErrorPanel
        error={snippet.error}
        title={t('onboarding.apply.snippetError')}
        onRetry={() => {
          void snippet.refetch()
        }}
      />
    )
  }
  if (!snippet.data) return null

  const warnings = asStringArray(snippet.data.warnings)
  const env = snippet.data.env_fixed
  const envEntries = env === null ? [] : Object.entries(env)

  return (
    <div className="space-y-1.5">
      {snippet.data.path.length > 0 ? (
        <CopyField label={t('onboarding.apply.pasteIn')} value={snippet.data.path} maxLines={2} />
      ) : null}
      <CopyField
        label={t('onboarding.apply.snippet', { name: snippet.data.name })}
        value={snippet.data.body}
        maxLines={12}
      />
      {envEntries.length > 0 ? (
        <p className="text-2xs text-primary/85">
          {t('onboarding.apply.envFixed', {
            vars: envEntries.map(([key, value]) => `${key}=${value}`).join(' · '),
          })}
        </p>
      ) : null}
      {warnings.map((warning) => (
        <p key={warning} className="text-2xs text-primary/85">
          {warning}
        </p>
      ))}
    </div>
  )
}

function ResultRow({
  provider,
  result,
  running,
}: {
  provider: MCPProvider | undefined
  result: MCPConfigureResult | undefined
  running: boolean
}) {
  const t = useT()
  const key = result?.key ?? provider?.key ?? ''
  const name = result?.name ?? provider?.name ?? key
  const action = result?.action

  if (running) {
    return (
      <div className="flex items-center gap-2 border border-border bg-panel px-2 py-2">
        <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
        <span className="text-xs text-foreground">{name}</span>
        <span className="text-2xs text-muted-foreground">{t('onboarding.apply.writing')}</span>
      </div>
    )
  }

  if (action === undefined) {
    // La llamada falló entera: no se inventa un resultado por cliente. El texto
    // no puede ser «sin respuesta», que suena a que fue este cliente el que no
    // contestó: lo que pasó es que no se llegó a escribir nada.
    return (
      <div className="flex items-center gap-2 border border-border bg-panel px-2 py-2">
        <CircleAlert className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {name}: {t('onboarding.apply.notAttempted')}
        </span>
      </div>
    )
  }

  const tone = ACTION_TONE[action] ?? 'neutral'
  const labelKey = ACTION_KEY[action]
  const label = labelKey === undefined ? action : t(labelKey)
  return (
    <div className="space-y-1.5 border border-border bg-panel px-2 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {actionIcon(action)}
        <span className="text-xs text-foreground">{name}</span>
        <Badge variant={tone === 'ok' ? 'secondary' : tone === 'bad' ? 'destructive' : 'outline'}>
          {label}
        </Badge>
        {result?.backup ? (
          <span className="text-2xs text-muted-foreground">
            {t('onboarding.apply.backupLabel')} <code>{result.backup}</code>
          </span>
        ) : null}
      </div>

      {result?.message ? (
        <p className={tone === 'bad' ? 'text-2xs text-destructive' : 'text-2xs text-muted-foreground'}>
          {result.message}
        </p>
      ) : null}

      {result?.path ? (
        <div className="text-2xs text-muted-foreground" title={result.path}>
          <code>{result.path}</code>
        </div>
      ) : null}

      {action === 'manual' && result !== undefined ? (
        result.command ? (
          <CopyField label={t('onboarding.apply.command')} value={result.command} maxLines={3} />
        ) : (
          <ManualSnippet providerKey={key} />
        )
      ) : null}
    </div>
  )
}

/**
 * Paso 3: aplicar.
 *
 * El core resuelve todos los clientes en una sola llamada, así que mientras está
 * en vuelo se muestra un spinner por cliente y, al volver, una fila por cada
 * resultado con lo que realmente pasó. `manual` nunca se pinta como fallo.
 */
export function StepApply({ providers, selected, autoRun = true, renderActions }: StepApplyProps) {
  const t = useT()
  const configure = useConfigureMCP()
  const started = useRef(false)
  const [results, setResults] = useState<MCPConfigureResult[]>([])
  // Sin autoRun nada está «en vuelo» al montar: si no, las filas se pintarían
  // como «escribiendo…» esperando una llamada que nadie lanzó.
  const [running, setRunning] = useState<string[]>(autoRun ? selected : [])
  const [binaryPath, setBinaryPath] = useState('')
  const [hasRun, setHasRun] = useState(autoRun)

  const run = useCallback(
    (keys: string[]) => {
      if (keys.length === 0) return
      setRunning(keys)
      configure.mutate(
        { providers: keys },
        {
          onSuccess: (data) => {
            setBinaryPath(data.binary_path)
            setResults((previous) => {
              const byKey = new Map(previous.map((item) => [item.key, item]))
              for (const item of asArray<MCPConfigureResult>(data.results)) byKey.set(item.key, item)
              return [...byKey.values()]
            })
            setRunning([])
            setHasRun(true)
          },
          onError: () => {
            setRunning([])
            setHasRun(true)
          },
        },
      )
    },
    [configure],
  )

  useEffect(() => {
    // StrictMode monta el efecto dos veces en desarrollo: la marca evita
    // configurar los clientes por duplicado.
    if (!autoRun || started.current) return
    started.current = true
    run(selected)
  }, [autoRun, run, selected])

  const failed = results.filter((item) => item.action === 'error').map((item) => item.key)
  const manual = results.filter((item) => item.action === 'manual')
  const pending = running.length > 0

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground">
        {pending ? `${t('onboarding.apply.configuring', { count: selected.length })} ` : null}
        {t('onboarding.apply.lead')}
      </p>
      {binaryPath.length > 0 ? (
        <p className="text-2xs text-muted-foreground">
          {t('onboarding.apply.binaryLabel')}{' '}
          <code className="break-all text-secondary">{binaryPath}</code>
        </p>
      ) : null}

      {renderActions ? renderActions({ run: () => run(selected), pending, done: hasRun }) : null}
      {configure.error ? (
        <ErrorPanel
          error={configure.error}
          title={t('onboarding.apply.writeError')}
          onRetry={() => run(selected)}
        />
      ) : null}

      {hasRun ? (
        <div className="space-y-1.5">
          {selected.map((key) => (
            <ResultRow
              key={key}
              provider={providers.find((provider) => provider.key === key)}
              result={results.find((item) => item.key === key)}
              running={running.includes(key)}
            />
          ))}
        </div>
      ) : null}

      {hasRun && !pending && results.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-2xs text-muted-foreground">
            {failed.length === 0
              ? t('onboarding.apply.allGood')
              : t('onboarding.apply.failed', { count: failed.length })}
          </span>
          {failed.length > 0 ? (
            <Button variant="outline" size="sm" onClick={() => run(failed)}>
              <RefreshCw className="size-3" />
              {t('onboarding.apply.retryFailed')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!pending && manual.length > 0 ? (
        <p className="text-2xs text-primary/85">
          {t('onboarding.apply.manualNote', { count: manual.length })}
        </p>
      ) : null}
    </div>
  )
}
