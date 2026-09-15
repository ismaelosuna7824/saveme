import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

import { api, errorMessage } from '@/api/client'
import type { Health } from '@/api/types'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

const MAX_ATTEMPTS = 30
const CORE_ADDRESS = '127.0.0.1:7411'

type Phase = 'waiting' | 'ready' | 'failed'

interface BootLine {
  kind: 'info' | 'warn' | 'error' | 'ok'
  text: string
}

/**
 * Puerta de arranque.
 *
 * No renderiza la app hasta que `GET /api/health` responde. Mientras tanto
 * muestra un log estilo shell con el número de intento, y si el core nunca
 * levanta deja un panel de diagnóstico con el último error y un botón para
 * reintentar. Nunca una pantalla en blanco.
 */
export function BootGate({ children }: { children: ReactNode }) {
  const t = useT()
  const [attempt, setAttempt] = useState(0)
  const [phase, setPhase] = useState<Phase>('waiting')
  const [health, setHealth] = useState<Health | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [lines, setLines] = useState<BootLine[]>([])
  const [generation, setGeneration] = useState(0)

  const retry = useCallback(() => {
    setAttempt(0)
    setPhase('waiting')
    setLastError(null)
    setLines([])
    setGeneration((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let current = 0

    const run = async () => {
      if (cancelled) return
      current += 1
      setAttempt(current)
      try {
        const result = await api.get<Health>('/health')
        if (cancelled) return
        setHealth(result)
        setPhase('ready')
        setLines((previous) => [
          ...previous.slice(-40),
          {
            kind: 'ok',
            text: t('shell.boot.coreReady', { version: result.version, rootDir: result.root_dir }),
          },
        ])
      } catch (cause) {
        if (cancelled) return
        const message = errorMessage(cause)
        setLastError(message)
        setLines((previous) => [...previous.slice(-40), { kind: 'error', text: message }])
        if (current >= MAX_ATTEMPTS) {
          setPhase('failed')
          return
        }
        const delay = Math.min(250 * 1.35 ** (current - 1), 2500)
        timer = setTimeout(() => {
          void run()
        }, delay)
      }
    }

    void run()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [generation, t])

  if (phase === 'ready' && health !== null) return <>{children}</>

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-3 flex items-baseline gap-2">
          <span className="prompt-caret">❯</span>
          <span className="text-sm text-primary">saveme</span>
          <span className="text-2xs text-muted-foreground">{t('shell.boot.tagline')}</span>
        </div>

        {phase === 'failed' ? (
          <div className="term-panel">
            <div className="term-panel-header">
              <AlertTriangle className="size-3 text-destructive" />
              {t('shell.boot.failedTitle')}
            </div>
            <div className="space-y-3 px-3 py-3">
              <p className="text-xs text-foreground">
                {t('shell.boot.failedBodyBefore', { count: MAX_ATTEMPTS })}{' '}
                <code className="text-secondary">{CORE_ADDRESS}</code>
                {t('shell.boot.failedBodyAfter')}
              </p>
              <div className="border border-border bg-sunken px-2 py-1.5">
                <div className="text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                  {t('shell.boot.lastError')}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">
                  {lastError ?? t('shell.boot.noDetail')}
                </div>
              </div>
              <ul className="space-y-1 text-2xs text-muted-foreground">
                <li>{t('shell.boot.hintStart')}</li>
                <li>{t('shell.boot.hintPort')}</li>
                <li>{t('shell.boot.hintLog')}</li>
              </ul>
              <Button onClick={retry} variant="outline" size="sm">
                <RotateCw className="size-3" />
                {t('common.actions.retry')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="term-panel term-frame">
            <div className="term-panel-header">{t('shell.boot.running')}</div>
            <div className="max-h-72 space-y-0.5 overflow-y-auto px-3 py-2 text-xs">
              {lines.slice(-8).map((line, index) => (
                <div key={`${index}-${line.text}`} className={lineClass(line.kind)}>
                  {line.text}
                </div>
              ))}
              <div className="text-primary">
                {t('shell.boot.waiting', {
                  attempt,
                  max: MAX_ATTEMPTS,
                  address: CORE_ADDRESS,
                })}
                <span className="boot-cursor ml-1" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function lineClass(kind: BootLine['kind']): string {
  switch (kind) {
    case 'error':
      return 'text-destructive'
    case 'ok':
      return 'text-secondary'
    case 'warn':
      return 'text-primary'
    default:
      return 'text-muted-foreground'
  }
}
