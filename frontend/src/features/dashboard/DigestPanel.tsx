import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CalendarDays } from 'lucide-react'

import { useDigest } from '@/api/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { categoryLabel } from '@/features/projects/CategoryCounts'
import { useT } from '@/i18n'
import { formatRelative } from '@/lib/format'

/** Las ventanas que se pueden pedir. Dos es suficiente para lo que responde. */
const VENTANAS = [7, 30] as const

/**
 * Qué se hizo estos días, cruzando todos los proyectos.
 *
 * Es la pregunta que el resto de la app no sabe responder: el inbox enseña lo que
 * espera aprobación y cada proyecto lo suyo, pero «qué hice esta semana» obliga a
 * ir proyecto por proyecto. Se agrupa por día, no por proyecto, porque uno se
 * acuerda de los días.
 */
export function DigestPanel() {
  const t = useT()
  const [dias, setDias] = useState<number>(VENTANAS[0])
  const { data, isPending, error } = useDigest(dias)

  return (
    <section className="space-y-1 border border-border bg-panel px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-3 shrink-0 text-accent" />
        <span className="text-2xs uppercase tracking-[0.14em] text-muted-foreground">
          {t('inbox.digest.title')}
        </span>

        {data !== undefined ? (
          <span className="text-2xs text-muted-foreground">
            {t('inbox.digest.counts', {
              count: data.count,
              projects: data.projects,
            })}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {VENTANAS.map((valor) => (
            <Button
              key={valor}
              size="sm"
              variant={dias === valor ? 'outline' : 'ghost'}
              onClick={() => setDias(valor)}
            >
              {t('inbox.digest.days', { count: valor })}
            </Button>
          ))}
        </div>
      </div>

      {isPending ? <Skeleton className="h-16 w-full" /> : null}

      {error ? (
        <p className="text-2xs text-destructive">{t('inbox.digest.failed')}</p>
      ) : null}

      {data !== undefined && data.count === 0 ? (
        <p className="text-2xs text-muted-foreground">
          {t('inbox.digest.empty', { count: data.days })}
        </p>
      ) : null}

      {data?.groups.map((grupo) => (
        <div key={grupo.date} className="border-t border-border pt-1 first:border-t-0">
          <div className="text-2xs text-muted-foreground">{grupo.date}</div>
          <ul className="space-y-0.5">
            {grupo.entries.map((entrada) => (
              <li key={entrada.id} className="flex flex-wrap items-baseline gap-1.5">
                <Badge variant="muted">{categoryLabel(t, entrada.category)}</Badge>
                {/* Se enlaza al resumen y no a una vista de solo lectura: el
                    digest sirve para volver a lo que escribiste, y volver es
                    abrirlo. */}
                <Link
                  to="/s/$id"
                  params={{ id: entrada.id }}
                  className="min-w-0 flex-1 truncate text-xs text-foreground hover:text-primary"
                  title={entrada.rel_path}
                >
                  {entrada.title}
                </Link>
                <code className="text-2xs text-muted-foreground">{entrada.project_slug}</code>
                <span className="text-2xs text-muted-foreground">
                  {formatRelative(entrada.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
